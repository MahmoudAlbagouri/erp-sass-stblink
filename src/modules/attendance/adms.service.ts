// src/modules/attendance/adms.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import {
  BiometricDevice,
  DeviceStatus,
} from './entities/biometric-device.entity';
import {
  AttendanceLog,
  PunchType,
  VerifyMode,
} from './entities/attendance-log.entity';
import { DeviceCommand } from './entities/device-command.entity';
import { Employee } from '../employees/entities/employee.entity';

const STATUS_TO_PUNCH_TYPE: Record<number, PunchType> = {
  0: PunchType.CHECK_IN,
  1: PunchType.CHECK_OUT,
  2: PunchType.BREAK_OUT,
  3: PunchType.BREAK_IN,
  4: PunchType.OVERTIME_IN,
  5: PunchType.OVERTIME_OUT,
};

const VERIFY_TO_MODE: Record<number, VerifyMode> = {
  1: VerifyMode.FINGERPRINT,
  2: VerifyMode.PASSWORD,
  3: VerifyMode.CARD,
  4: VerifyMode.FACE,
  15: VerifyMode.FINGERPRINT_CARD,
};

@Injectable()
export class AdmsService {
  private readonly logger = new Logger(AdmsService.name);

  constructor(
    @InjectRepository(BiometricDevice)
    private readonly deviceRepo: Repository<BiometricDevice>,
    @InjectRepository(AttendanceLog)
    private readonly logRepo: Repository<AttendanceLog>,
    @InjectRepository(Employee)
    private readonly employeeRepo: Repository<Employee>,
    private readonly dataSource: DataSource,
  ) {}

  async handleDeviceInit(
    sn: string,
    meta: { ip?: string } | undefined,
  ): Promise<string> {
    const device = await this.deviceRepo.findOneBy({ serialNumber: sn });

    // ✅ رفض الأجهزة غير المسجلة لأسباب أمنية
    if (!device) {
      this.logger.warn(
        `️ Unauthorized device SN=${sn} connected from ${meta?.ip ?? 'unknown'}`,
      );
      return 'ERROR: Device not registered';
    }

    await this.deviceRepo.update(device.id, {
      status: DeviceStatus.ONLINE,
      lastSeenAt: new Date(),
      ipAddress: meta?.ip,
    });

    const now = new Date();
    return [
      `GET TIME`,
      `Stamp=${now.getTime()}`,
      `ServerVer=2.4.1`,
      `Time=${this.formatZkDate(now)}`,
      ``,
    ].join('\r\n');
  }

  async processAttendanceLogs(
    sn: string,
    rawData: string,
    stamp?: string,
  ): Promise<number> {
    const device = await this.deviceRepo.findOneBy({ serialNumber: sn });
    if (!device) return 0;

    const lines = rawData
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return 0;

    let savedCount = 0;

    // ✅ تحسين الأداء: جلب الـ IDs الموجودة مسبقاً دفعة واحدة
    const potentialRawIds = lines
      .map((l) => this.parseAttlogLine(l)?.rawLogId)
      .filter(Boolean) as string[];
    const existingRawIds = new Set(
      (
        await this.logRepo.find({
          where: { deviceSn: sn, rawLogId: In(potentialRawIds) },
          select: ['rawLogId'],
        })
      ).map((l) => l.rawLogId!),
    );

    await this.dataSource.transaction(async (manager) => {
      for (const line of lines) {
        const parsed = this.parseAttlogLine(line);

        // ✅ تخطي الأسطر غير الصالحة أو المكررة بسرعة O(1)
        if (!parsed || existingRawIds.has(parsed.rawLogId)) continue;

        const employee = await manager.findOne(Employee, {
          where: { employeeCode: parsed.pin, tenantId: device.tenantId },
        });

        const log = manager.create(AttendanceLog, {
          deviceUserId: parsed.pin,
          employeeId: employee?.id ?? undefined,
          deviceId: device.id,
          tenantId: device.tenantId,
          punchTime: parsed.punchTime,
          punchType: STATUS_TO_PUNCH_TYPE[parsed.status] ?? PunchType.CHECK_IN,
          verifyMode: VERIFY_TO_MODE[parsed.verify] ?? VerifyMode.FINGERPRINT,
          deviceSn: sn,
          rawLogId: parsed.rawLogId,
        });

        await manager.save(log);
        savedCount++;
      }

      if (stamp) {
        await manager.update(BiometricDevice, device.id, {
          lastLogIndex: parseInt(stamp, 10),
          lastSeenAt: new Date(),
        });
      }
    });

    return savedCount;
  }

  async getPendingCommand(sn: string): Promise<string | null> {
    const device = await this.deviceRepo.findOneBy({ serialNumber: sn });
    if (!device) return null;

    const cmd = await this.dataSource.getRepository(DeviceCommand).findOne({
      where: { deviceId: device.id, isExecuted: false },
      order: { createdAt: 'ASC' },
    });

    return cmd ? `C:${cmd.id}:${cmd.command}` : null;
  }

  async confirmCommandExecution(commandId: string): Promise<void> {
    await this.dataSource
      .getRepository(DeviceCommand)
      .update(commandId, { isExecuted: true });
  }

  private parseAttlogLine(line: string) {
    const parts = line.split(/\t| {2,}/);
    if (parts.length < 4) return null;
    const [pin, dateTimeStr, statusStr, verifyStr] = parts;
    if (!pin || !dateTimeStr) return null;

    // ✅ تخزين التوقيت كـ UTC لتجنب مشاكل المناطق الزمنية
    const punchTime = new Date(dateTimeStr.replace(' ', 'T') + 'Z');
    if (isNaN(punchTime.getTime())) return null;

    const rawLogId = `${pin}_${dateTimeStr.replace(/[: ]/g, '')}`;
    return {
      pin,
      punchTime,
      status: parseInt(statusStr ?? '0', 10),
      verify: parseInt(verifyStr ?? '1', 10),
      rawLogId,
    };
  }

  private formatZkDate(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
}
