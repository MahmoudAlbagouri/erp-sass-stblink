// src/modules/notifications/scanners/attendance-devices.scanner.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PERMS } from '../../../common/constants/permissions';
import { Audience } from '../notification-audience.service';
import { NotifierService } from '../notifier.service';
import { type NotificationScanner, scanAllTenants } from './scanner.util';

/** الجهاز يسأل كل ~10 ثوانٍ: ساعة بلا اتصال انقطاع حقيقي */
const OFFLINE_AFTER_MINUTES = 60;
/** جهاز منقطع من زمن أطول لا يُنبَّه به (متروك عمداً) */
const IGNORE_AFTER_DAYS = 3;

/**
 * جهاز بصمة انقطع: البصمات لا تصل والحضور سيظهر ناقصاً. المفتاح آخر ظهور
 * للجهاز: تنبيه واحد لكل انقطاع، ويعود التنبيه إن عاد ثم انقطع.
 */
@Injectable()
export class AttendanceDevicesScanner implements NotificationScanner {
  readonly label = 'تنبيهات أجهزة البصمة';
  private readonly logger = new Logger(AttendanceDevicesScanner.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifier: NotifierService,
  ) {}

  @Cron('0 5,35 * * * *')
  run(): Promise<void> {
    return scanAllTenants(this.dataSource, this, this.logger);
  }

  async scanTenant(tenantId: string): Promise<void> {
    const devices = await this.dataSource.query<
      {
        id: string;
        name: string;
        location: string | null;
        branchId: string | null;
        lastSeenAt: Date;
      }[]
    >(
      `SELECT d.id, COALESCE(d.alias, d."serialNumber") AS name, d.location,
              d.branch_id AS "branchId", d.last_seen_at AS "lastSeenAt"
         FROM biometric_devices d
        WHERE d.tenant_id = $1 AND d."isActive" AND d.last_seen_at IS NOT NULL
          AND d.last_seen_at < now() - make_interval(mins => $2)
          AND d.last_seen_at > now() - make_interval(days => $3)`,
      [tenantId, OFFLINE_AFTER_MINUTES, IGNORE_AFTER_DAYS],
    );

    for (const device of devices) {
      const lastSeen = new Date(device.lastSeenAt);
      await this.notifier.notifySafe({
        tenantId,
        type: 'device_offline',
        severity: 'warning',
        title: `جهاز البصمة «${device.name}» غير متصل`,
        body: 'البصمات لا تصل منذ آخر اتصال — تأكد من الكهرباء والشبكة',
        details: [
          { label: 'الجهاز', value: device.name },
          ...(device.location
            ? [{ label: 'الموقع', value: device.location }]
            : []),
          {
            label: 'آخر اتصال',
            value: lastSeen.toISOString(),
            format: 'datetime',
          },
        ],
        entity: { type: 'biometric_device', id: device.id },
        link: '/dashboard/attendance',
        to: Audience.can(PERMS.BIOMETRIC_DEVICE_UPDATE.name, device.branchId),
        dedupeKey: `device_offline:${device.id}:${lastSeen.getTime()}`,
      });
    }
  }
}
