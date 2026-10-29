// src/modules/notifications/scanners/subscription-expiry.scanner.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { dayKeyInZone } from '../../../common/utils/timezone.util';
import { Audience } from '../notification-audience.service';
import {
  dayText,
  NotificationLookupService,
} from '../notification-lookup.service';
import { NotifierService } from '../notifier.service';
import {
  daysBetweenKeys,
  type NotificationScanner,
  scanAllTenants,
  stageOf,
  whenText,
} from './scanner.util';

const STAGES = [7, 3, 1, 0];
const EXPIRED_GRACE_DAYS = 3;

/** اشتراك الشركة يقترب من نهايته (7، 3، 1 يوم، ثم «انتهى»): لمديري الشركة */
@Injectable()
export class SubscriptionExpiryScanner implements NotificationScanner {
  readonly label = 'تنبيهات انتهاء الاشتراك';
  private readonly logger = new Logger(SubscriptionExpiryScanner.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifier: NotifierService,
    private readonly lookup: NotificationLookupService,
  ) {}

  @Cron('0 20 */6 * * *')
  run(): Promise<void> {
    return scanAllTenants(this.dataSource, this, this.logger);
  }

  async scanTenant(tenantId: string, now = new Date()): Promise<void> {
    // آخر اشتراك للشركة هو الحاكم (نفس قاعدة getActiveSubscription)
    const rows = await this.dataSource.query<
      { id: string; status: string; endDate: Date | null; planName: string }[]
    >(
      `SELECT s.id, s.status, s."endDate", p."nameAr" AS "planName"
         FROM subscriptions s JOIN plans p ON p.id = s."planId"
        WHERE s."tenantId" = $1
        ORDER BY s.created_at DESC LIMIT 1`,
      [tenantId],
    );
    const sub = rows[0];
    if (!sub?.endDate || !['active', 'trial', 'expired'].includes(sub.status)) {
      return;
    }

    const { zone } = await this.lookup.locale(tenantId);
    const end = dayKeyInZone(new Date(sub.endDate), zone);
    const daysLeft = daysBetweenKeys(dayKeyInZone(now, zone), end);
    const stage = stageOf(daysLeft, STAGES, EXPIRED_GRACE_DAYS);
    if (stage === null) return;

    const expired = stage === 'expired' || sub.status === 'expired';
    const trial = sub.status === 'trial';
    const noun = trial ? 'الفترة التجريبية' : 'اشتراك شركتك';

    await this.notifier.notifySafe({
      tenantId,
      type: 'subscription',
      severity: expired || daysLeft <= 1 ? 'danger' : 'warning',
      title: expired ? `انتهى ${noun}` : `${noun} ينتهي ${whenText(daysLeft)}`,
      body: expired
        ? `انتهى ${noun} (${sub.planName}) في ${dayText(end)} — جدّده لتستمر الخدمة`
        : `${noun} (${sub.planName}) ينتهي في ${dayText(end)} — جدّده لتجنب توقف الخدمة`,
      details: [
        { label: 'الباقة', value: sub.planName },
        { label: 'ينتهي في', value: end, format: 'date' },
      ],
      data: { dueDate: end, stage },
      link: '/dashboard/subscription',
      to: Audience.admins(),
      dedupeKey: `subscription_expiry:${sub.id}:${end}:${expired ? 'expired' : stage}`,
    });
  }
}
