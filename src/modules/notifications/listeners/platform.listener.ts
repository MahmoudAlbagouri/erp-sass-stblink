// src/modules/notifications/listeners/platform.listener.ts
// المنصة: شركة جديدة تسجّل (لمالك النظام)، وتغيّر اشتراك شركة (لمديريها).
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { getCountry } from '../../../common/constants/countries';
import type { DomainEventMap } from '../../../common/events/domain-events';
import { Audience } from '../notification-audience.service';
import { dayKey, dayText } from '../notification-lookup.service';
import type { NotificationSeverity } from '../notification-types';
import { NotifierService } from '../notifier.service';

const EVENT = { async: true } as const;

const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  active: 'فعّال',
  trial: 'تجريبي',
  expired: 'منتهٍ',
  cancelled: 'ملغى',
  suspended: 'موقوف',
  pending: 'بانتظار التفعيل',
};

const SUBSCRIPTION_ACTION: Record<
  DomainEventMap['subscription.updated']['action'],
  { title: string; severity: NotificationSeverity }
> = {
  renewed: { title: 'جُدّد اشتراك شركتك', severity: 'success' },
  plan_changed: { title: 'تغيّرت باقة اشتراكك', severity: 'info' },
  status_changed: { title: 'تغيّرت حالة اشتراكك', severity: 'warning' },
  cancelled: { title: 'أُلغي اشتراك شركتك', severity: 'danger' },
};

@Injectable()
export class PlatformListener {
  constructor(private readonly notifier: NotifierService) {}

  @OnEvent('tenant.registered', EVENT)
  async onTenantRegistered(
    e: DomainEventMap['tenant.registered'],
  ): Promise<void> {
    await this.notifier.notifySafe({
      tenantId: null,
      type: 'tenant_registered',
      severity: 'success',
      title: `شركة جديدة سجّلت: ${e.companyName}`,
      body: `سجّل مديرها بالبريد ${e.adminEmail}`,
      details: [
        { label: 'الشركة', value: e.companyName },
        { label: 'بريد المدير', value: e.adminEmail },
        { label: 'الدولة', value: getCountry(e.country).nameAr },
      ],
      entity: { type: 'tenant', id: e.tenantId },
      link: '/dashboard/companies',
      to: Audience.systemAdmins(),
      dedupeKey: `tenant_registered:${e.tenantId}`,
    });
  }

  @OnEvent('subscription.updated', EVENT)
  async onSubscriptionUpdated(
    e: DomainEventMap['subscription.updated'],
  ): Promise<void> {
    const action = SUBSCRIPTION_ACTION[e.action];
    const status = SUBSCRIPTION_STATUS_LABEL[e.status] ?? e.status;
    const parts = [`الحالة: ${status}`];
    if (e.planName) parts.push(`الباقة: ${e.planName}`);
    if (e.endDate) parts.push(`حتى ${dayText(e.endDate)}`);

    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'subscription',
      severity: action.severity,
      title: action.title,
      body: parts.join(' — '),
      details: [
        { label: 'الحالة', value: status },
        ...(e.planName ? [{ label: 'الباقة', value: e.planName }] : []),
        ...(e.endDate
          ? [
              {
                label: 'ينتهي في',
                value: dayKey(new Date(e.endDate)),
                format: 'date' as const,
              },
            ]
          : []),
      ],
      link: '/dashboard/subscription',
      to: Audience.admins(),
      exclude: [e.actorUserId],
    });
  }
}
