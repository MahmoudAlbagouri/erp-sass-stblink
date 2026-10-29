// src/modules/notifications/scanners/accounting-errors.scanner.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PERMS } from '../../../common/constants/permissions';
import { Audience } from '../notification-audience.service';
import { NotifierService } from '../notifier.service';
import { AlertStatesService } from './alert-states.service';
import { type NotificationScanner, scanAllTenants } from './scanner.util';

const PREFIX = 'posting_errors:';
const LISTED = 5;

/**
 * مستندات تعذّر ترحيلها محاسبياً (الترحيل الدوري يعيد المحاولة كل دقيقة
 * ويسجّل السبب): تنبيه واحد عند ظهورها، ويعود إن ظهرت بعد أن خلت.
 */
@Injectable()
export class AccountingErrorsScanner implements NotificationScanner {
  readonly label = 'تنبيهات أخطاء الترحيل المحاسبي';
  private readonly logger = new Logger(AccountingErrorsScanner.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifier: NotifierService,
    private readonly alerts: AlertStatesService,
  ) {}

  @Cron('0 10 * * * *')
  run(): Promise<void> {
    return scanAllTenants(this.dataSource, this, this.logger);
  }

  async scanTenant(tenantId: string): Promise<void> {
    const errors = await this.dataSource.query<
      { sourceType: string; message: string; attempts: number }[]
    >(
      `SELECT "sourceType", message, attempts FROM accounting_posting_errors
        WHERE "tenantId" = $1 ORDER BY "lastSeenAt" DESC`,
      [tenantId],
    );
    const key = `${PREFIX}${tenantId}`;
    const raised = await this.alerts.sync(
      tenantId,
      PREFIX,
      errors.length ? [key] : [],
    );
    if (raised.length === 0) return;

    const result = await this.notifier.notifySafe({
      tenantId,
      type: 'posting_errors',
      severity: 'danger',
      title: `تعذّر ترحيل ${errors.length} مستند محاسبياً`,
      body: 'القيود الناقصة تجعل التقارير المالية غير مكتملة — راجع الأسباب وصحّحها',
      details: [
        { label: 'عدد المستندات', value: errors.length },
        ...errors.slice(0, LISTED).map((error) => ({
          label: error.sourceType,
          value: error.message,
        })),
      ],
      link: '/dashboard/accounting',
      to: [
        Audience.can(PERMS.ACCOUNTS_MANAGE.name),
        Audience.can(PERMS.ACCOUNTING_SETTINGS_MANAGE.name),
      ],
    });
    if (!result) await this.alerts.release(raised);
  }
}
