// src/modules/attendance/adms.service.ts
// استقبال أجهزة البصمة (ZKTeco) عبر بروتوكول ADMS / Push: الجهاز هو من يتصل
// بالسيرفر — يعرّف نفسه، يرفع البصمات، ويسأل دورياً عن أوامر تخصه.
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
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
import { AttendanceService } from './attendance.service';
import {
  isValidTimezone,
  tenantTimezoneOf,
  utcOffsetMinutes,
  zonedTimeToUtc,
} from '../../common/utils/timezone.util';

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

/** الجهاز يسأل عن أوامره كل بضع ثوانٍ: لا نكتب "آخر ظهور" مع كل سؤال */
const HEARTBEAT_WRITE_INTERVAL_MS = 30 * 1000;
const MAX_INT32 = 2147483647;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** بصمة تاريخها أبعد من هذا في المستقبل تعني ساعة جهاز غير مضبوطة */
const CLOCK_SKEW_WARNING_MS = 10 * 60 * 1000;

interface ParsedPunch {
  pin: string;
  punchTime: Date;
  status: number;
  verify: number;
  rawLogId: string;
}

@Injectable()
export class AdmsService {
  private readonly logger = new Logger(AdmsService.name);

  constructor(
    @InjectRepository(BiometricDevice)
    private readonly deviceRepo: Repository<BiometricDevice>,
    private readonly dataSource: DataSource,
    private readonly attendanceService: AttendanceService,
  ) {}

  // ══════════════════════════ التعريف (handshake) ══════════════════════════

  /**
   * أول اتصال من الجهاز: نعيد له إعدادات المزامنة. يعيد null لجهاز غير مسجّل
   * أو موقوف.
   *
   * `TimeZone` هي ما يضبط ساعة الجهاز: الجهاز يأخذ الوقت من ترويسة Date في
   * ردودنا (دائماً UTC) ويضيف إليها هذا الفرق — فتعرض شاشته توقيت الشركة،
   * وبه يختم بصماته.
   */
  async handleDeviceInit(
    sn: string,
    meta: { ip?: string } = {},
  ): Promise<string | null> {
    const device = await this.findActiveDevice(sn);
    if (!device) {
      this.logger.warn(
        `Rejected device SN=${sn} from ${meta.ip ?? 'unknown'} (not registered or disabled)`,
      );
      return null;
    }

    await this.deviceRepo.update(device.id, {
      status: DeviceStatus.ONLINE,
      lastSeenAt: new Date(),
      ipAddress: meta.ip,
    });

    const zone = await this.deviceZone(device);
    return [
      `GET OPTION FROM: ${sn}`,
      // آخر ما استلمناه: الجهاز يرفع ما بعده فقط (الصيغتان لاختلاف الإصدارات)
      `Stamp=${device.lastLogIndex}`,
      `ATTLOGStamp=${device.lastLogIndex}`,
      `OPERLOGStamp=9999`,
      `ATTPHOTOStamp=None`,
      `ErrorDelay=30`, // ثوانٍ قبل إعادة المحاولة بعد فشل
      `Delay=10`, // ثوانٍ بين كل سؤال عن الأوامر
      `TransTimes=00:00;14:05`, // رفع احتياطي مجدول، فوق الرفع الفوري
      `TransInterval=1`,
      `TransFlag=TransData AttLog`,
      `TimeZone=${toDeviceTimeZone(utcOffsetMinutes(zone))}`,
      `Realtime=1`, // كل بصمة تُرفع لحظة تسجيلها
      `Encrypt=None`,
      ``,
    ].join('\r\n');
  }

  // ══════════════════════════ رفع البصمات ══════════════════════════

  /**
   * يحفظ دفعة بصمات ويعيد عدد الجديد منها. يعيد null لجهاز غير مسجّل أو
   * موقوف — فيحتفظ الجهاز بالدفعة ويعيد رفعها لاحقاً.
   *
   * إعادة رفع نفس البصمة لا تكرّرها: كل بصمة تُعرَّف بـ (الجهاز، الموظف، وقتها).
   */
  async processAttendanceLogs(
    sn: string,
    rawData: string,
    stamp?: string,
  ): Promise<number | null> {
    const device = await this.findActiveDevice(sn);
    if (!device) return null;

    const zone = await this.deviceZone(device);
    const punches = this.parseBatch(rawData, zone, sn);

    const saved = await this.dataSource.transaction(async (manager) => {
      // دفعتان متزامنتان من نفس الجهاز (رفع فوري + مجدول) تتواليان هنا، فلا
      // تريان معاً أن البصمة "غير موجودة" وتحفظانها مرتين
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `adms:${sn}`,
      ]);

      const fresh = await this.withoutKnown(manager, sn, punches);
      const logs = await this.saveLogs(manager, device, fresh);

      const lastLogIndex = parseStamp(stamp);
      await manager.update(BiometricDevice, device.id, {
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date(),
        ...(lastLogIndex === null ? {} : { lastLogIndex }),
      });

      // بعد حفظ الدفعة كلها: بصمة الحضور المقابلة قد تكون في نفس الدفعة
      for (const log of logs) {
        await this.attendanceService.recalculateAround(log, manager);
      }
      return logs.length;
    });

    return saved;
  }

  /** أسطر الدفعة الصالحة، بلا تكرار داخل الدفعة نفسها */
  private parseBatch(rawData: string, zone: string, sn: string): ParsedPunch[] {
    const byRawId = new Map<string, ParsedPunch>();
    let skipped = 0;

    for (const line of rawData.split('\n')) {
      if (!line.trim()) continue;
      const punch = parseAttlogLine(line, zone);
      if (!punch) {
        skipped++;
        continue;
      }
      byRawId.set(punch.rawLogId, punch);
    }

    if (skipped > 0) {
      this.logger.warn(`Skipped ${skipped} malformed ATTLOG line(s), SN=${sn}`);
    }
    const ahead = [...byRawId.values()].filter(
      (p) => p.punchTime.getTime() - Date.now() > CLOCK_SKEW_WARNING_MS,
    ).length;
    if (ahead > 0) {
      this.logger.warn(
        `SN=${sn} sent ${ahead} punch(es) dated in the future: device clock or timezone is off`,
      );
    }

    return [...byRawId.values()];
  }

  private async withoutKnown(
    manager: EntityManager,
    sn: string,
    punches: ParsedPunch[],
  ): Promise<ParsedPunch[]> {
    if (punches.length === 0) return [];

    const known = await manager.find(AttendanceLog, {
      where: { deviceSn: sn, rawLogId: In(punches.map((p) => p.rawLogId)) },
      select: { id: true, rawLogId: true },
    });
    const knownIds = new Set(known.map((log) => log.rawLogId));
    return punches.filter((p) => !knownIds.has(p.rawLogId));
  }

  private async saveLogs(
    manager: EntityManager,
    device: BiometricDevice,
    punches: ParsedPunch[],
  ): Promise<AttendanceLog[]> {
    if (punches.length === 0) return [];

    // رقم الموظف على الجهاز (PIN) هو كود الموظف في النظام
    const pins = [...new Set(punches.map((p) => p.pin))];
    const employees = await manager.find(Employee, {
      where: { tenantId: device.tenantId, employeeCode: In(pins) },
      select: { id: true, employeeCode: true },
    });
    const employeeIdByPin = new Map(
      employees.map((e) => [e.employeeCode, e.id]),
    );

    return manager.save(
      punches.map((punch) =>
        manager.create(AttendanceLog, {
          deviceUserId: punch.pin,
          // بصمة لرقم غير معروف تُحفظ بلا موظف: تظهر في السجل ليُراجَع الربط
          employeeId: employeeIdByPin.get(punch.pin),
          deviceId: device.id,
          tenantId: device.tenantId,
          punchTime: punch.punchTime,
          // مرجع مهلة التعديل (24 ساعة) حتى بعد تعديل punchTime
          originalPunchTime: punch.punchTime,
          punchType: STATUS_TO_PUNCH_TYPE[punch.status] ?? PunchType.CHECK_IN,
          verifyMode: VERIFY_TO_MODE[punch.verify] ?? VerifyMode.FINGERPRINT,
          deviceSn: device.serialNumber,
          rawLogId: punch.rawLogId,
          isManualEntry: false,
        }),
      ),
      { chunk: 500 },
    );
  }

  // ══════════════════════════ الأوامر ══════════════════════════

  /** سؤال الجهاز الدوري: الأمر التالي بصيغة `C:<id>:<command>`، أو null */
  async getPendingCommand(sn: string): Promise<string | null> {
    const device = await this.findActiveDevice(sn);
    if (!device) return null;

    await this.touch(device);

    const command = await this.dataSource.getRepository(DeviceCommand).findOne({
      where: { deviceId: device.id, isExecuted: false },
      order: { createdAt: 'ASC' },
    });
    return command ? `C:${command.id}:${command.command}` : null;
  }

  /**
   * نتيجة تنفيذ الأوامر كما يرسلها الجهاز: سطر لكل أمر بصيغة
   * `ID=<id>&Return=<code>&CMD=<name>`. يعيد عدد الأوامر المؤكَّدة.
   */
  async confirmCommands(sn: string, body: string): Promise<number> {
    const device = await this.findActiveDevice(sn);
    if (!device) return 0;

    let confirmed = 0;
    for (const line of body.split('\n')) {
      const params = new URLSearchParams(line.trim());
      const id = params.get('ID');
      if (!id || !UUID_PATTERN.test(id)) continue;

      const returnCode = Number.parseInt(params.get('Return') ?? '', 10);
      // مقيَّد بالجهاز: جهاز لا يؤكد أمراً يخص جهازاً آخر
      const result = await this.dataSource.getRepository(DeviceCommand).update(
        { id, deviceId: device.id, isExecuted: false },
        {
          isExecuted: true,
          executedAt: new Date(),
          returnCode: Number.isNaN(returnCode) ? null : returnCode,
        },
      );
      confirmed += result.affected ?? 0;

      if (!Number.isNaN(returnCode) && returnCode !== 0) {
        this.logger.warn(
          `Device SN=${sn} failed command ${id} (Return=${returnCode})`,
        );
      }
    }
    return confirmed;
  }

  // ══════════════════════════ داخلي ══════════════════════════

  private async findActiveDevice(sn: string): Promise<BiometricDevice | null> {
    const device = await this.deviceRepo.findOneBy({ serialNumber: sn });
    if (!device || !device.isActive) return null;
    return device.status === DeviceStatus.DISABLED ? null : device;
  }

  /** منطقة ساعة الجهاز: المحددة عليه، وإلا منطقة شركته */
  private deviceZone(device: BiometricDevice): Promise<string> {
    return isValidTimezone(device.timezone)
      ? Promise.resolve(device.timezone)
      : tenantTimezoneOf(this.dataSource.manager, device.tenantId);
  }

  private async touch(device: BiometricDevice): Promise<void> {
    const lastSeen = device.lastSeenAt?.getTime() ?? 0;
    if (
      device.status === DeviceStatus.ONLINE &&
      Date.now() - lastSeen < HEARTBEAT_WRITE_INTERVAL_MS
    ) {
      return;
    }
    await this.deviceRepo.update(device.id, {
      status: DeviceStatus.ONLINE,
      lastSeenAt: new Date(),
    });
  }
}

/**
 * سطر ATTLOG: `PIN <tab> YYYY-MM-DD HH:mm:ss <tab> status <tab> verify …`.
 * الوقت بساعة الجهاز المحلية بلا منطقة: يُقرأ بمنطقة الجهاز ليصير لحظة حقيقية.
 */
export function parseAttlogLine(
  line: string,
  zone: string,
): ParsedPunch | null {
  const [pin, dateTime, status, verify] = line
    .trim()
    .split(/\t| {2,}/)
    .map((part) => part.trim());
  if (!pin || !dateTime) return null;

  const punchTime = zonedTimeToUtc(dateTime, zone);
  if (!punchTime) return null;

  return {
    pin,
    punchTime,
    status: toInt(status, 0),
    verify: toInt(verify, 1),
    // معرّف البصمة على الجهاز: نفس الموظف لا يبصم مرتين في نفس الثانية
    rawLogId: `${pin}_${dateTime.replace(/[: ]/g, '')}`,
  };
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseStamp(stamp?: string): number | null {
  const value = Number.parseInt(stamp ?? '', 10);
  return Number.isInteger(value) && value >= 0 && value <= MAX_INT32
    ? value
    : null;
}

/**
 * فرق التوقيت كما تفهمه أجهزة ZKTeco: ساعات صحيحة (3، ‎-5). الفروق غير
 * الصحيحة (‎+5:30) تُرسل بالدقائق، وهي الصيغة التي تقبلها الإصدارات الحديثة.
 */
function toDeviceTimeZone(offsetMinutes: number): string {
  return offsetMinutes % 60 === 0
    ? String(offsetMinutes / 60)
    : String(offsetMinutes);
}
