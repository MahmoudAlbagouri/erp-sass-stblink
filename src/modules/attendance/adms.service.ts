// src/modules/attendance/adms.service.ts
// استقبال أجهزة البصمة (ZKTeco) عبر بروتوكول ADMS / Push: الجهاز هو من يتصل
// بالسيرفر — يعرّف نفسه، يرفع البصمات، ويسأل دورياً عن أوامر تخصه.
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, LessThan, Not, Repository } from 'typeorm';
import {
  BiometricDevice,
  DeviceProtocol,
  DeviceStatus,
} from './entities/biometric-device.entity';
import { PunchType, VerifyMode } from './entities/attendance-log.entity';
import { DeviceCommand } from './entities/device-command.entity';
import { AttendanceSettingsService } from './attendance-settings.service';
import {
  BiometricSyncService,
  MAX_COMMAND_ATTEMPTS,
  RESEND_AFTER_MS,
} from './biometric-sync.service';
import { type IncomingPunch, PunchIngestService } from './punch-ingest.service';
import { CHECK_COMMAND, isLegacyPush } from './utils/zk-protocol';
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

/** طريقة التحقق كما ترسلها أجهزة ZKTeco (الأرقام المركّبة الأخرى = "أخرى") */
const VERIFY_TO_MODE: Record<number, VerifyMode> = {
  0: VerifyMode.PASSWORD,
  1: VerifyMode.FINGERPRINT,
  2: VerifyMode.CARD,
  3: VerifyMode.PASSWORD,
  4: VerifyMode.CARD,
  15: VerifyMode.FACE,
  25: VerifyMode.PALM,
};

/** الجهاز يسأل عن أوامره كل بضع ثوانٍ: لا نكتب "آخر ظهور" مع كل سؤال */
const HEARTBEAT_WRITE_INTERVAL_MS = 30 * 1000;
const MAX_INT32 = 2147483647;

/** بصمة تاريخها أبعد من هذا في المستقبل تعني ساعة جهاز غير مضبوطة */
const CLOCK_SKEW_WARNING_MS = 10 * 60 * 1000;

/** أوامر في الرد الواحد على سؤال الجهاز (الأجهزة القديمة: أمر واحد) */
const COMMANDS_PER_POLL = 10;
const MAX_POLL_RESPONSE_CHARS = 60_000;

/** طلب تعريف جهاز لم يعرّف نفسه: مرة كل هذه المدة على الأكثر */
const HANDSHAKE_REQUEST_INTERVAL_MS = 10 * 60 * 1000;

/** ما يطلب الجهاز رفعه: البصمات، ومع نسخ البصمات سجل المستخدمين وقوالبهم */
const TRANS_FLAG_ATTENDANCE = 'TransData AttLog';
const TRANS_FLAG_WITH_TEMPLATES =
  'TransData AttLog OpLog EnrollUser ChgUser EnrollFP ChgFP FACE';

export interface DeviceRequestMeta {
  ip?: string | null;
  pushVersion?: string | null;
}

interface ParsedPunch extends IncomingPunch {
  status: number;
  verify: number;
}

@Injectable()
export class AdmsService {
  private readonly logger = new Logger(AdmsService.name);

  constructor(
    @InjectRepository(BiometricDevice)
    private readonly deviceRepo: Repository<BiometricDevice>,
    private readonly dataSource: DataSource,
    private readonly ingest: PunchIngestService,
    private readonly sync: BiometricSyncService,
    private readonly settings: AttendanceSettingsService,
  ) {}

  // ══════════════════════════ التعريف (handshake) ══════════════════════════

  /**
   * أول اتصال من الجهاز: نعيد له إعدادات المزامنة. يعيد null لجهاز غير مسجّل
   * أو موقوف أو يتصل من عنوان غير مسموح.
   *
   * `TimeZone` هي ما يضبط ساعة الجهاز: الجهاز يأخذ الوقت من ترويسة Date في
   * ردودنا (دائماً UTC) ويضيف إليها هذا الفرق — فتعرض شاشته توقيت الشركة،
   * وبه يختم بصماته.
   */
  async handleDeviceInit(
    sn: string,
    meta: DeviceRequestMeta = {},
  ): Promise<string | null> {
    const device = await this.admitted(sn, meta);
    if (!device) return null;

    // التعريف مصدر الإصدار: جهاز لا يعلنه Push 1.x (الصيغة القديمة)
    await this.deviceRepo.update(device.id, {
      status: DeviceStatus.ONLINE,
      lastSeenAt: new Date(),
      handshakeAt: new Date(),
      pushVersion: meta.pushVersion?.trim().slice(0, 20) || null,
    });

    const [zone, policy] = await Promise.all([
      this.deviceZone(device),
      this.settings.getPolicy(device.tenantId),
    ]);
    return [
      `GET OPTION FROM: ${sn}`,
      // آخر ما استلمناه: الجهاز يرفع ما بعده فقط (الصيغتان لاختلاف الإصدارات)
      `Stamp=${device.lastLogIndex}`,
      `ATTLOGStamp=${device.lastLogIndex}`,
      // سجل المستخدمين والبصمات يُطلب فقط حين تنسخ الشركة البصمات بين أجهزتها
      `OPERLOGStamp=${policy.syncBiometrics ? device.operLogStamp : 9999}`,
      `ATTPHOTOStamp=None`,
      `ErrorDelay=30`, // ثوانٍ قبل إعادة المحاولة بعد فشل
      `Delay=10`, // ثوانٍ بين كل سؤال عن الأوامر
      `TransTimes=00:00;14:05`, // رفع احتياطي مجدول، فوق الرفع الفوري
      `TransInterval=1`,
      `TransFlag=${policy.syncBiometrics ? TRANS_FLAG_WITH_TEMPLATES : TRANS_FLAG_ATTENDANCE}`,
      `TimeZone=${toDeviceTimeZone(utcOffsetMinutes(zone))}`,
      `Realtime=1`, // كل بصمة تُرفع لحظة تسجيلها
      `Encrypt=None`,
      ``,
    ].join('\r\n');
  }

  // ══════════════════════════ رفع البصمات ══════════════════════════

  /**
   * يحفظ دفعة بصمات ويعيد عدد الجديد منها. يعيد null لجهاز مرفوض — فيحتفظ
   * الجهاز بالدفعة ويعيد رفعها لاحقاً.
   *
   * إعادة رفع نفس البصمة لا تكرّرها: كل بصمة تُعرَّف بـ (الجهاز، الموظف، وقتها).
   */
  async processAttendanceLogs(
    sn: string,
    rawData: string,
    stamp?: string,
    meta: DeviceRequestMeta = {},
  ): Promise<number | null> {
    const device = await this.admitted(sn, meta);
    if (!device) return null;

    const zone = await this.deviceZone(device);
    const punches = this.parseBatch(rawData, zone, sn);

    return this.dataSource.transaction(async (manager) => {
      const { saved } = await this.ingest.save(
        {
          tenantId: device.tenantId,
          deviceId: device.id,
          sourceKey: device.serialNumber,
        },
        punches,
        manager,
      );

      const lastLogIndex = parseStamp(stamp);
      await manager.update(BiometricDevice, device.id, {
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date(),
        ...(lastLogIndex === null ? {} : { lastLogIndex }),
      });
      return saved.length;
    });
  }

  /**
   * سجل العمليات (OPERLOG) أو قوالب BIODATA: المستخدمون وبصماتهم كما سُجّلت
   * على الجهاز. يعيد عدد الأسطر المستلمة، أو null لجهاز مرفوض.
   */
  async processOperationLog(
    sn: string,
    body: string,
    stamp?: string,
    meta: DeviceRequestMeta = {},
  ): Promise<number | null> {
    const device = await this.admitted(sn, meta);
    if (!device) return null;

    const count = await this.sync.receive(device, body);
    const operLogStamp = parseStamp(stamp);
    await this.deviceRepo.update(device.id, {
      status: DeviceStatus.ONLINE,
      lastSeenAt: new Date(),
      ...(operLogStamp === null ? {} : { operLogStamp }),
    });
    return count;
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

  // ══════════════════════════ الأوامر ══════════════════════════

  /**
   * سؤال الجهاز الدوري: أوامره التالية بصيغة `C:<seq>:<command>` (سطر لكل
   * أمر ينتهي بسطر جديد؛ أمر واحد للأجهزة القديمة)، أو null إن لم يكن له شيء.
   *
   * أمر سُلِّم ولم يرد عليه الجهاز يُعاد بعد مهلة، ويُترك بعد عدد من المحاولات
   * — فلا يسد ما بعده.
   */
  async getPendingCommand(
    sn: string,
    meta: DeviceRequestMeta = {},
  ): Promise<string | null> {
    const device = await this.admitted(sn, meta);
    if (!device) return null;

    await this.touch(device);

    const commands = this.dataSource.getRepository(DeviceCommand);
    const pending = device.handshakeAt
      ? await this.dueCommands(
          device.id,
          isLegacyPush(device.pushVersion) ? 1 : COMMANDS_PER_POLL,
        )
      : await this.handshakeRequest(device);

    const lines: string[] = [];
    const sent: string[] = [];
    let size = 0;
    for (const command of pending) {
      if (command.attempts >= MAX_COMMAND_ATTEMPTS) {
        // يظهر "لم يرد الجهاز"؛ رده إن وصل متأخراً يُسجَّل
        await commands.update(command.id, {
          isExecuted: true,
          executedAt: new Date(),
        });
        this.logger.warn(
          `SN=${sn} never answered command ${command.seq}: dropped after ${command.attempts} attempt(s)`,
        );
        continue;
      }
      const text = await this.sync.render(command.command, device);
      if (text === null) {
        // قالب حُذف (أوقفت الشركة النسخ): لا شيء يُرسل
        await commands.update(command.id, {
          isExecuted: true,
          executedAt: new Date(),
        });
        continue;
      }
      const line = `C:${command.seq}:${text}\n`;
      if (lines.length > 0 && size + line.length > MAX_POLL_RESPONSE_CHARS) {
        break;
      }
      lines.push(line);
      sent.push(command.id);
      size += line.length;
    }
    if (sent.length > 0) {
      await commands.update(
        { id: In(sent) },
        { attempts: () => '"attempts" + 1', sentAt: new Date() },
      );
    }
    return lines.length > 0 ? lines.join('') : null;
  }

  /** أوامر الجهاز المنتظرة: لم تُسلَّم بعد، أو سُلِّمت ومرت مهلة ردها */
  private dueCommands(
    deviceId: string,
    take: number,
    command?: string,
  ): Promise<DeviceCommand[]> {
    const waiting = {
      deviceId,
      isExecuted: false,
      ...(command ? { command } : {}),
    };
    return this.dataSource.getRepository(DeviceCommand).find({
      where: [
        { ...waiting, sentAt: IsNull() },
        {
          ...waiting,
          sentAt: LessThan(new Date(Date.now() - RESEND_AFTER_MS)),
        },
      ],
      order: { seq: 'ASC' },
      take,
    });
  }

  /**
   * جهاز لم يعرّف نفسه منذ أُضيف (حُذف وأعيد وهو متصل مثلاً): صيغة أوامره
   * مجهولة فلا يُرسل منها شيء، بل يُطلب تعريفه بـ CHECK فيعلن إصداره — حين
   * تنتظره أوامر فقط، ومرة كل بضع دقائق على الأكثر.
   */
  private async handshakeRequest(
    device: BiometricDevice,
  ): Promise<DeviceCommand[]> {
    const due = await this.dueCommands(device.id, 1, CHECK_COMMAND);
    if (due.length > 0) return due;

    const commands = this.dataSource.getRepository(DeviceCommand);
    const waiting = await commands.exists({
      where: {
        deviceId: device.id,
        isExecuted: false,
        command: Not(CHECK_COMMAND),
      },
    });
    if (!waiting) return [];

    const last = await commands.findOne({
      where: { deviceId: device.id, command: CHECK_COMMAND },
      order: { seq: 'DESC' },
    });
    // من انتهائه (executedAt بمنطقة زمنية، لا createdAt)
    if (
      last &&
      (!last.isExecuted ||
        Date.now() - (last.executedAt?.getTime() ?? 0) <
          HANDSHAKE_REQUEST_INTERVAL_MS)
    ) {
      return [];
    }
    return this.sync.enqueue(device, [CHECK_COMMAND]);
  }

  /**
   * نتيجة تنفيذ الأوامر كما يرسلها الجهاز: سطر لكل أمر بصيغة
   * `ID=<seq>&Return=<code>&CMD=<name>`. يعيد عدد الأوامر المؤكَّدة.
   */
  async confirmCommands(
    sn: string,
    body: string,
    meta: DeviceRequestMeta = {},
  ): Promise<number> {
    const device = await this.admitted(sn, meta);
    if (!device) return 0;

    let confirmed = 0;
    for (const line of body.split('\n')) {
      const params = new URLSearchParams(line.trim());
      const id = params.get('ID') ?? '';
      const seq = Number(id);
      if (!/^\d+$/.test(id) || seq > MAX_INT32) continue;

      const returnCode = Number.parseInt(params.get('Return') ?? '', 10);
      // مقيَّد بالجهاز: جهاز لا يؤكد أمراً يخص جهازاً آخر. ورد متأخر على أمر
      // تُرك بعد محاولاته يُسجَّل أيضاً
      const result = await this.dataSource.getRepository(DeviceCommand).update(
        { seq, deviceId: device.id, returnCode: IsNull() },
        {
          isExecuted: true,
          executedAt: new Date(),
          returnCode: Number.isNaN(returnCode) ? null : returnCode,
        },
      );
      confirmed += result.affected ?? 0;

      // النجاح 0 فأكثر (CHECK يرد بـ 1)
      if (!Number.isNaN(returnCode) && returnCode < 0) {
        this.logger.warn(
          `Device SN=${sn} failed command ${id} (Return=${returnCode})`,
        );
      }
    }
    return confirmed;
  }

  // ══════════════════════════ داخلي ══════════════════════════

  /** جهاز ZKTeco مسجّل ومفعّل، ويتصل من عنوان مسموح */
  private async admitted(
    sn: string,
    meta: DeviceRequestMeta,
  ): Promise<BiometricDevice | null> {
    const device = await this.deviceRepo.findOneBy({ serialNumber: sn });
    if (
      !device ||
      !device.isActive ||
      device.status === DeviceStatus.DISABLED ||
      device.protocol !== DeviceProtocol.ZK_ADMS
    ) {
      this.logger.warn(
        `Rejected device SN=${sn} from ${meta.ip ?? 'unknown'} (not registered, disabled or not ZKTeco)`,
      );
      return null;
    }
    return (await this.ingest.admit(device, meta.ip)) ? device : null;
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

  const statusCode = toInt(status, 0);
  const verifyCode = toInt(verify, 1);
  return {
    pin,
    punchTime,
    status: statusCode,
    verify: verifyCode,
    // بلا زر حالة ترسل بعض الأجهزة 255: حضور، والحساب بأول بصمة وآخرها
    punchType: STATUS_TO_PUNCH_TYPE[statusCode] ?? PunchType.CHECK_IN,
    verifyMode: VERIFY_TO_MODE[verifyCode] ?? VerifyMode.OTHER,
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
