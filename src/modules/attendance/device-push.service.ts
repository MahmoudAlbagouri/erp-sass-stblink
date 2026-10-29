// src/modules/attendance/device-push.service.ts
// أجهزة غير ZKTeco: Hikvision ترسل أحداثها (HTTP Listening) إلى رابط خاص
// بالجهاز، وأي جهاز أو برنامج وسيط آخر يرسل البصمات JSON بمفتاح الجهاز.
// المفتاح يُولَّد عند إضافة الجهاز ويُعرض مرة واحدة؛ يُحفظ بصمته فقط.
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  BiometricDevice,
  DeviceProtocol,
  DeviceStatus,
} from './entities/biometric-device.entity';
import { PunchType, VerifyMode } from './entities/attendance-log.entity';
import { type IncomingPunch, PunchIngestService } from './punch-ingest.service';
import { PushPunchesDto } from './dto/push-punches.dto';
import { deviceKeyMatches } from '../pos/utils/pos-crypto.util';
import {
  isValidTimezone,
  tenantTimezoneOf,
  zonedTimeToUtc,
} from '../../common/utils/timezone.util';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** حدث Hikvision لشخص تعرّف عليه الجهاز (المجموعة 5 = أحداث الدخول) */
const HIK_MAJOR_EVENT = 5;

const HIK_ATTENDANCE_STATUS: Record<string, PunchType> = {
  checkin: PunchType.CHECK_IN,
  checkout: PunchType.CHECK_OUT,
  breakout: PunchType.BREAK_OUT,
  breakin: PunchType.BREAK_IN,
  overtimein: PunchType.OVERTIME_IN,
  overtimeout: PunchType.OVERTIME_OUT,
};

/** طريقة التحقق الفعلية من نوع الحدث الفرعي */
const HIK_SUB_EVENT_VERIFY: Record<number, VerifyMode> = {
  1: VerifyMode.CARD,
  38: VerifyMode.FINGERPRINT,
  75: VerifyMode.FACE,
};

export interface PushResult {
  received: number;
  saved: number;
  duplicates: number;
  /** بصمات لأرقام غير مربوطة بموظف (تُحفظ وتظهر في "أرقام غير مربوطة") */
  unlinked: number;
}

@Injectable()
export class DevicePushService {
  private readonly logger = new Logger(DevicePushService.name);

  constructor(
    @InjectRepository(BiometricDevice)
    private readonly deviceRepo: Repository<BiometricDevice>,
    private readonly dataSource: DataSource,
    private readonly ingest: PunchIngestService,
  ) {}

  /** الجهاز صاحب المعرّف والمفتاح، إن كان مفعّلاً ومن هذا النوع */
  async authenticate(
    deviceId: string | undefined,
    key: string | undefined,
    protocol: DeviceProtocol,
  ): Promise<BiometricDevice | null> {
    if (!deviceId || !key || !UUID_PATTERN.test(deviceId)) return null;
    const device = await this.deviceRepo
      .createQueryBuilder('device')
      .addSelect('device.pushKeyHash')
      .where('device.id = :deviceId', { deviceId })
      .getOne();
    if (
      !device?.pushKeyHash ||
      device.protocol !== protocol ||
      !device.isActive ||
      device.status === DeviceStatus.DISABLED ||
      !deviceKeyMatches(key, device.pushKeyHash)
    ) {
      return null;
    }
    return device;
  }

  /** أحداث Hikvision: يحفظ بصمات من تعرّف عليهم الجهاز، ويتجاهل غيرها */
  async receiveHikvision(
    device: BiometricDevice,
    events: unknown[],
    ip: string | null,
  ): Promise<PushResult | null> {
    if (!(await this.ingest.admit(device, ip))) return null;
    const zone = await this.deviceZone(device);
    const punches = events
      .map((event) => parseHikvisionEvent(event, zone))
      .filter((punch): punch is IncomingPunch => punch !== null);
    return this.store(device, punches, events.length);
  }

  /** بصمات من جهاز أو برنامج وسيط بصيغتنا */
  async receiveApi(
    device: BiometricDevice,
    dto: PushPunchesDto,
    ip: string | null,
  ): Promise<PushResult | null> {
    if (!(await this.ingest.admit(device, ip))) return null;
    const zone = await this.deviceZone(device);
    const punches: IncomingPunch[] = [];
    for (const punch of dto.punches) {
      const punchTime = parseDeviceTime(punch.time, zone);
      if (!punchTime) continue;
      punches.push({
        pin: punch.pin.trim(),
        punchTime,
        rawLogId: punch.id?.trim() || punchId(punch.pin, punchTime),
        punchType: punch.type ?? PunchType.CHECK_IN,
        verifyMode: punch.verifyMode ?? VerifyMode.OTHER,
      });
    }
    return this.store(device, punches, dto.punches.length);
  }

  private async store(
    device: BiometricDevice,
    punches: IncomingPunch[],
    received: number,
  ): Promise<PushResult> {
    const { saved } = await this.ingest.save(
      {
        tenantId: device.tenantId,
        deviceId: device.id,
        sourceKey: device.serialNumber,
      },
      punches,
    );
    await this.deviceRepo.update(device.id, {
      status: DeviceStatus.ONLINE,
      lastSeenAt: new Date(),
    });
    if (saved.length > 0) {
      this.logger.log(
        `Saved ${saved.length} punch(es) from ${device.protocol} device ${device.serialNumber}`,
      );
    }
    return {
      received,
      saved: saved.length,
      duplicates: punches.length - saved.length,
      unlinked: saved.filter((log) => !log.employeeId).length,
    };
  }

  private deviceZone(device: BiometricDevice): Promise<string> {
    return isValidTimezone(device.timezone)
      ? Promise.resolve(device.timezone)
      : tenantTimezoneOf(this.dataSource.manager, device.tenantId);
  }
}

/**
 * أحداث Hikvision من جسم الطلب: JSON مباشرة، أو حقل في multipart (عادةً
 * event_log) يحمل JSON — ومعه صورة نتجاهلها.
 */
export function collectHikvisionEvents(body: unknown): unknown[] {
  if (!body || typeof body !== 'object') return [];
  const record = body as Record<string, unknown>;
  if ('eventType' in record) return [record];

  const events: unknown[] = [];
  for (const value of Object.values(record)) {
    if (typeof value !== 'string' || !value.trim().startsWith('{')) continue;
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && 'eventType' in parsed) {
        events.push(parsed);
      }
    } catch {
      // حقل ليس JSON
    }
  }
  return events;
}

/**
 * حدث AccessControllerEvent لشخص تعرّف عليه الجهاز ← بصمة. أحداث أخرى
 * (نبض الاتصال، فتح باب، شخص غريب) تعيد null.
 */
export function parseHikvisionEvent(
  event: unknown,
  zone: string,
): IncomingPunch | null {
  if (!event || typeof event !== 'object') return null;
  const outer = event as Record<string, unknown>;
  if (outer.eventType !== 'AccessControllerEvent') return null;
  const detail = (outer.AccessControllerEvent ?? {}) as Record<string, unknown>;
  if (Number(detail.majorEventType) !== HIK_MAJOR_EVENT) return null;

  const pin = text(detail.employeeNoString ?? detail.employeeNo).trim();
  if (!pin || !/^[A-Za-z0-9]{1,20}$/.test(pin)) return null;

  const rawTime = typeof outer.dateTime === 'string' ? outer.dateTime : '';
  const punchTime = parseDeviceTime(rawTime, zone);
  if (!punchTime) return null;

  const status = text(detail.attendanceStatus).toLowerCase();
  return {
    pin,
    punchTime,
    rawLogId: punchId(pin, punchTime),
    punchType: HIK_ATTENDANCE_STATUS[status] ?? PunchType.CHECK_IN,
    verifyMode: hikVerifyMode(detail),
  };
}

function hikVerifyMode(detail: Record<string, unknown>): VerifyMode {
  const bySubEvent = HIK_SUB_EVENT_VERIFY[Number(detail.subEventType)];
  if (bySubEvent) return bySubEvent;
  const mode = text(detail.currentVerifyMode).toLowerCase();
  if (mode === 'face') return VerifyMode.FACE;
  if (mode === 'fp') return VerifyMode.FINGERPRINT;
  if (mode === 'card') return VerifyMode.CARD;
  return VerifyMode.OTHER;
}

/** قيمة نصية أو رقمية من JSON الجهاز؛ غيرها نص فارغ */
function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

/** وقت بمنطقته (‎+03:00 أو Z) لحظةً كما هو، وبلا منطقة بتوقيت الجهاز */
export function parseDeviceTime(value: string, zone: string): Date | null {
  const text = value.trim();
  if (!text) return null;
  if (/(z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const time = Date.parse(text);
    return Number.isNaN(time) ? null : new Date(time);
  }
  return zonedTimeToUtc(text, zone);
}

/** معرّف بصمة ثابت: الرقم + اللحظة بالثانية */
function punchId(pin: string, time: Date): string {
  return `${pin.trim()}_${time.toISOString().slice(0, 19).replace(/[-:T]/g, '')}`;
}
