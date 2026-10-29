// src/modules/attendance/punch-ingest.service.ts
// المدخل الواحد لحفظ بصمات تصل من أي مصدر: أجهزة ZKTeco، أجهزة Hikvision،
// أي جهاز عبر الـ API، أو ملف Excel مستورد. يمنع التكرار، ويربط كل بصمة
// بموظفها، ويقرر هل يُقبل اتصال الجهاز أصلاً (القفل على عنوان IP).
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  AttendanceLog,
  PunchType,
  VerifyMode,
} from './entities/attendance-log.entity';
import { BiometricDevice } from './entities/biometric-device.entity';
import { DomainEvents } from '../../common/events/domain-events';
import { employeesByPin, pinKey } from './utils/attendance-pin';
import { ipAllowed, normalizeIp } from './utils/ip-allowlist';

export interface IncomingPunch {
  /** رقم الموظف على الجهاز */
  pin: string;
  punchTime: Date;
  /** معرّف البصمة عند مصدرها: إعادة إرسالها لا تكرّرها */
  rawLogId: string;
  punchType: PunchType;
  verifyMode: VerifyMode;
}

export interface PunchSource {
  tenantId: string;
  deviceId: string | null;
  /** نطاق منع التكرار: الرقم التسلسلي للجهاز، أو مصدر الاستيراد */
  sourceKey: string;
  createdBy?: { id: string; name?: string | null };
}

const LOOKUP_CHUNK = 1000;
/** تنبيه/تسجيل واحد لكل جهاز وعنوان في هذه المدة (الجهاز يتصل كل ثوانٍ) */
const ALERT_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class PunchIngestService {
  private readonly logger = new Logger(PunchIngestService.name);
  private readonly lastAlert = new Map<string, number>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly events: DomainEvents,
  ) {}

  /**
   * يحفظ الجديد من البصمات. نفس البصمة (نفس المصدر ومعرّفها) لا تُحفظ مرتين،
   * حتى بين دفعتين متزامنتين.
   */
  async save(
    source: PunchSource,
    punches: IncomingPunch[],
    outer?: EntityManager,
  ): Promise<{ saved: AttendanceLog[]; duplicates: number }> {
    const unique = new Map<string, IncomingPunch>();
    for (const punch of punches) unique.set(punch.rawLogId, punch);
    const batch = [...unique.values()];
    if (batch.length === 0) return { saved: [], duplicates: punches.length };

    const run = async (manager: EntityManager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `punches:${source.sourceKey}`,
      ]);

      const fresh = await this.withoutKnown(manager, source.sourceKey, batch);
      if (fresh.length === 0) return [];

      const employeeIdByPin = await employeesByPin(
        manager,
        source.tenantId,
        fresh.map((p) => p.pin),
      );
      return manager.save(
        fresh.map((punch) =>
          manager.create(AttendanceLog, {
            deviceUserId: punch.pin,
            // رقم غير مربوط بموظف يُحفظ كما هو: يظهر في "أرقام غير مربوطة"
            // ويُربط هو وكل ما سبقه حين يُربط
            employeeId: employeeIdByPin.get(pinKey(punch.pin)),
            deviceId: source.deviceId ?? undefined,
            tenantId: source.tenantId,
            punchTime: punch.punchTime,
            // مرجع مهلة التعديل (24 ساعة) حتى بعد تعديل punchTime
            originalPunchTime: punch.punchTime,
            punchType: punch.punchType,
            verifyMode: punch.verifyMode,
            deviceSn: source.sourceKey,
            rawLogId: punch.rawLogId,
            isManualEntry: false,
            createdByUserId: source.createdBy?.id,
            createdByName: source.createdBy?.name ?? undefined,
          }),
        ),
        { chunk: 500 },
      );
    };

    const saved = outer
      ? await run(outer)
      : await this.dataSource.transaction(run);
    return { saved, duplicates: punches.length - saved.length };
  }

  private async withoutKnown(
    manager: EntityManager,
    sourceKey: string,
    punches: IncomingPunch[],
  ): Promise<IncomingPunch[]> {
    const knownIds = new Set<string>();
    for (let i = 0; i < punches.length; i += LOOKUP_CHUNK) {
      const ids = punches.slice(i, i + LOOKUP_CHUNK).map((p) => p.rawLogId);
      const known = await manager.find(AttendanceLog, {
        where: { deviceSn: sourceKey, rawLogId: In(ids) },
        select: { id: true, rawLogId: true },
      });
      for (const log of known) knownIds.add(log.rawLogId!);
    }
    return punches.filter((p) => !knownIds.has(p.rawLogId));
  }

  /**
   * يقبل اتصال الجهاز أو يرفضه. مقفول على عناوين: يُرفض من غيرها (مع تنبيه).
   * غير مقفول: يُقبل، ويُنبَّه حين يتغير عنوانه — جهاز مسروق الرقم يظهر هنا.
   */
  async admit(
    device: BiometricDevice,
    rawIp?: string | null,
  ): Promise<boolean> {
    const ip = normalizeIp(rawIp);
    const name = device.alias || device.serialNumber;

    let allowed = true;
    try {
      allowed = ipAllowed(ip, device.allowedIps);
    } catch {
      // قائمة تالفة لا تفتح الباب
      allowed = false;
    }
    if (!allowed) {
      if (this.shouldAlert(`blocked:${device.id}:${ip}`)) {
        this.logger.warn(
          `Blocked device SN=${device.serialNumber} from ${ip ?? 'unknown'} (not in allowed IPs)`,
        );
        this.events.emit('attendance.device_blocked', {
          tenantId: device.tenantId,
          deviceId: device.id,
          deviceName: name,
          branchId: device.branchId,
          ip,
        });
      }
      return false;
    }

    if (ip && ip !== device.ipAddress) {
      const previousIp = device.ipAddress;
      await this.dataSource
        .getRepository(BiometricDevice)
        .update(device.id, { ipAddress: ip });
      device.ipAddress = ip;
      if (previousIp && this.shouldAlert(`moved:${device.id}:${ip}`)) {
        this.events.emit('attendance.device_ip_changed', {
          tenantId: device.tenantId,
          deviceId: device.id,
          deviceName: name,
          branchId: device.branchId,
          previousIp,
          ip,
        });
      }
    }
    return true;
  }

  private shouldAlert(key: string): boolean {
    const now = Date.now();
    const last = this.lastAlert.get(key) ?? 0;
    if (now - last < ALERT_INTERVAL_MS) return false;
    this.lastAlert.set(key, now);
    return true;
  }
}
