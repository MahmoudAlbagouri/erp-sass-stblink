// src/modules/attendance/biometric-sync.service.ts
// طابور أوامر أجهزة ZKTeco، ونسخ بصمات الموظفين بين أجهزة الشركة: الموظف
// يسجّل إصبعه (أو وجهه) على جهاز واحد، فيصل قالبه لباقي الأجهزة.
//
// القوالب بيانات حيوية: تُحفظ فقط إن فعّلت الشركة النسخ، مشفّرة، وتُحذف كلها
// عند إيقافه. وأمر الإرسال في الطابور يشير للقالب ولا يحمله — يُبنى لحظة
// تسليمه للجهاز، فلا يبقى قالب مقروء في سجل الأوامر.
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  BiometricDevice,
  DeviceProtocol,
  DeviceStatus,
} from './entities/biometric-device.entity';
import { BiometricTemplate } from './entities/biometric-template.entity';
import { DeviceCommand } from './entities/device-command.entity';
import { Employee } from '../employees/entities/employee.entity';
import { AttendanceSettingsService } from './attendance-settings.service';
import { employeePin, employeesByPin, pinKey } from './utils/attendance-pin';
import { decryptTemplate, encryptTemplate } from './utils/template-cipher';
import {
  commandForDevice,
  parseTemplateLine,
  templateCommand,
  type TemplateRecord,
  userInfoCommand,
} from './utils/zk-protocol';

/** أمر يشير لقالب محفوظ: `@TEMPLATE <id> PIN=<رقم الموظف على الجهاز>` */
const TEMPLATE_REF = /^@TEMPLATE ([0-9a-f-]{36}) PIN=(.+)$/;

@Injectable()
export class BiometricSyncService {
  private readonly logger = new Logger(BiometricSyncService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: AttendanceSettingsService,
  ) {}

  // ═════════════════════════════ الطابور ═════════════════════════════

  /**
   * يضيف أوامر لطابور الجهاز بترتيبها؛ أمر ما زال بانتظار الجهاز لا يُكرَّر.
   * يعيد أوامر الطابور المقابلة (الموجود منها والجديد).
   */
  async enqueue(
    device: Pick<BiometricDevice, 'id' | 'tenantId'>,
    commands: string[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<DeviceCommand[]> {
    if (commands.length === 0) return [];
    const repo = manager.getRepository(DeviceCommand);
    const pending = await repo.find({
      where: { deviceId: device.id, isExecuted: false, command: In(commands) },
    });
    const byCommand = new Map(pending.map((c) => [c.command, c]));

    const result: DeviceCommand[] = [];
    for (const command of commands) {
      let queued = byCommand.get(command);
      if (!queued) {
        queued = await repo.save({
          deviceId: device.id,
          tenantId: device.tenantId,
          command,
          isExecuted: false,
        });
        byCommand.set(command, queued);
      }
      result.push(queued);
    }
    return result;
  }

  /** تسجيل الموظف على الجهاز، ومعه قوالب بصماته المحفوظة */
  async queueEmployee(
    device: Pick<BiometricDevice, 'id' | 'tenantId'>,
    employee: Employee,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<DeviceCommand[]> {
    const pin = employeePin(employee);
    const templates = await this.templatesOf(
      device.tenantId,
      [employee],
      manager,
    );
    return this.enqueue(
      device,
      [
        userInfoCommand(pin, employee.fullName),
        ...(templates.get(employee.id) ?? []).map((t) =>
          templateRef(t.id, pin),
        ),
      ],
      manager,
    );
  }

  /** كل الموظفين النشطين إلى جهاز (جهاز جديد أو أعيدت تهيئته) */
  async queueAllEmployees(
    device: Pick<BiometricDevice, 'id' | 'tenantId'>,
    branchId?: string | null,
  ): Promise<number> {
    const employees = await this.dataSource.getRepository(Employee).find({
      where: {
        tenantId: device.tenantId,
        status: 'active',
        ...(branchId ? { branchId } : {}),
      },
      order: { fullName: 'ASC' },
    });
    const templates = await this.templatesOf(device.tenantId, employees);
    const commands = employees.flatMap((employee) => {
      const pin = employeePin(employee);
      return [
        userInfoCommand(pin, employee.fullName),
        ...(templates.get(employee.id) ?? []).map((t) =>
          templateRef(t.id, pin),
        ),
      ];
    });
    await this.enqueue(device, commands);
    return employees.length;
  }

  /**
   * الأمر كما يُرسل للجهاز: بصيغة إصداره، والقالب المشار إليه مفكوك. null
   * لقالب حُذف أو لا يُفك (يُتخطى الأمر).
   */
  async render(
    command: string,
    device: Pick<BiometricDevice, 'tenantId' | 'pushVersion'>,
  ): Promise<string | null> {
    const ref = TEMPLATE_REF.exec(command);
    if (!ref) return commandForDevice(command, device.pushVersion);

    const template = await this.dataSource
      .getRepository(BiometricTemplate)
      .findOneBy({ id: ref[1], tenantId: device.tenantId });
    const fields = template ? decryptTemplate(template.data) : null;
    if (!template || fields === null) return null;
    return commandForDevice(
      templateCommand(ref[2], template.kind, fields),
      device.pushVersion,
    );
  }

  // ═════════════════════════════ استلام القوالب ═════════════════════════════

  /**
   * سجل عمليات من جهاز (مستخدمون وبصمات): يحفظ القوالب الجديدة أو المتغيرة
   * لموظفين مربوطين، وينسخها لباقي أجهزة الشركة. يعيد عدد الأسطر المستلمة.
   */
  async receive(device: BiometricDevice, body: string): Promise<number> {
    const lines = body.split('\n').filter((line) => line.trim());
    const policy = await this.settings.getPolicy(device.tenantId);
    if (!policy.syncBiometrics) return lines.length;

    const records = lines
      .map(parseTemplateLine)
      .filter((record): record is TemplateRecord => record !== null);
    if (records.length === 0) return lines.length;

    const changed = await this.dataSource.transaction(async (manager) => {
      const employeeIds = await employeesByPin(
        manager,
        device.tenantId,
        records.map((r) => r.pin),
      );
      const fresh: { template: BiometricTemplate; employeeId: string }[] = [];

      for (const record of records) {
        const key = pinKey(record.pin);
        const employeeId = employeeIds.get(key) ?? null;
        const repo = manager.getRepository(BiometricTemplate);
        const existing = await repo.findOneBy({
          tenantId: device.tenantId,
          pinKey: key,
          kind: record.kind,
          slot: record.slot,
        });
        // نفس القالب عاد من جهاز نسخناه إليه: لا شيء جديد (ولا حلقة نسخ)
        if (existing && decryptTemplate(existing.data) === record.fields) {
          if (employeeId && !existing.employeeId) {
            await repo.update(existing.id, { employeeId });
          }
          continue;
        }
        const template = await repo.save({
          ...(existing ?? {}),
          tenantId: device.tenantId,
          pinKey: key,
          employeeId,
          kind: record.kind,
          slot: record.slot,
          data: encryptTemplate(record.fields),
          sourceDeviceId: device.id,
        });
        if (employeeId) fresh.push({ template, employeeId });
      }
      return fresh;
    });

    if (changed.length > 0) await this.spread(device, changed);
    return lines.length;
  }

  /** ينسخ قوالب جديدة لكل أجهزة ZKTeco الأخرى في الشركة */
  private async spread(
    source: BiometricDevice,
    changed: { template: BiometricTemplate; employeeId: string }[],
  ): Promise<void> {
    const targets = await this.dataSource.getRepository(BiometricDevice).find({
      where: {
        tenantId: source.tenantId,
        protocol: DeviceProtocol.ZK_ADMS,
        isActive: true,
      },
    });
    const others = targets.filter(
      (d) => d.id !== source.id && d.status !== DeviceStatus.DISABLED,
    );
    if (others.length === 0) return;

    const employees = await this.dataSource.getRepository(Employee).findBy({
      id: In([...new Set(changed.map((c) => c.employeeId))]),
    });
    const byId = new Map(employees.map((e) => [e.id, e]));

    for (const device of others) {
      const commands: string[] = [];
      for (const { template, employeeId } of changed) {
        const employee = byId.get(employeeId);
        if (!employee) continue;
        const pin = employeePin(employee);
        commands.push(
          userInfoCommand(pin, employee.fullName),
          templateRef(template.id, pin),
        );
      }
      await this.enqueue(device, [...new Set(commands)]);
    }
    this.logger.log(
      `Queued ${changed.length} template(s) from SN=${source.serialNumber} to ${others.length} device(s)`,
    );
  }

  /** عند إيقاف النسخ: لا يبقى قالب على السيرفر، ولا أمر ينتظر إرساله */
  async purge(tenantId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(BiometricTemplate, { tenantId });
      await manager.query(
        `DELETE FROM device_commands
          WHERE "tenantId" = $1 AND NOT "isExecuted" AND "command" LIKE '@TEMPLATE %'`,
        [tenantId],
      );
    });
  }

  private async templatesOf(
    tenantId: string,
    employees: Employee[],
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Map<string, BiometricTemplate[]>> {
    const map = new Map<string, BiometricTemplate[]>();
    if (employees.length === 0) return map;
    const policy = await this.settings.getPolicy(tenantId, manager);
    if (!policy.syncBiometrics) return map;

    const templates = await manager.find(BiometricTemplate, {
      where: { tenantId, employeeId: In(employees.map((e) => e.id)) },
      select: { id: true, employeeId: true, kind: true, slot: true },
      order: { kind: 'ASC', slot: 'ASC' },
    });
    for (const template of templates) {
      const list = map.get(template.employeeId!) ?? [];
      list.push(template);
      map.set(template.employeeId!, list);
    }
    return map;
  }
}

function templateRef(templateId: string, pin: string): string {
  return `@TEMPLATE ${templateId} PIN=${pin}`;
}
