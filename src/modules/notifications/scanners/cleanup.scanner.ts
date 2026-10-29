// src/modules/notifications/scanners/cleanup.scanner.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { scannersDisabled } from './scanner.util';

/** حذف ما انتهت مدة الاحتفاظ به، وحالات تنبيه شركات حُذفت */
@Injectable()
export class NotificationsCleanupScanner {
  private readonly logger = new Logger(NotificationsCleanupScanner.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    if (scannersDisabled()) return;
    try {
      const [, expired] = await this.dataSource.query<[unknown, number]>(
        `DELETE FROM notifications WHERE "expiresAt" < now()`,
      );
      await this.dataSource.query(
        `DELETE FROM notification_alert_states s
          WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = s."tenantId")`,
      );
      if (expired) this.logger.log(`removed ${expired} expired notifications`);
    } catch (error) {
      this.logger.error(
        `notifications cleanup failed: ${(error as Error).message}`,
      );
    }
  }
}
