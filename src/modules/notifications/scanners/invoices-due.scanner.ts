// src/modules/notifications/scanners/invoices-due.scanner.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PERMS } from '../../../common/constants/permissions';
import { dayKeyInZone } from '../../../common/utils/timezone.util';
import type { NotificationDetail } from '../entities/notification.entity';
import { Audience } from '../notification-audience.service';
import { NotificationLookupService } from '../notification-lookup.service';
import type { NotificationType } from '../notification-types';
import { NotifierService } from '../notifier.service';
import { AlertStatesService } from './alert-states.service';
import { type NotificationScanner, scanAllTenants } from './scanner.util';

/** فواتير الموردين يُنبَّه بها قبل استحقاقها بهذه الأيام */
const SUPPLIER_DAYS_AHEAD = 3;
const LISTED = 10;

interface DueInvoice {
  id: string;
  number: string;
  party: string | null;
  branchId: string | null;
  dueDate: string;
  remaining: string;
}

/**
 * فلوس الشركة: فواتير عملاء تجاوزت استحقاقها ولم تُحصَّل، وفواتير موردين
 * تستحق خلال أيام. كل فاتورة يُنبَّه بها مرة (مجمّعة لكل فرع)، ويُمسح أثرها
 * حين تُسدَّد.
 */
@Injectable()
export class InvoicesDueScanner implements NotificationScanner {
  readonly label = 'تنبيهات استحقاق الفواتير';
  private readonly logger = new Logger(InvoicesDueScanner.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifier: NotifierService,
    private readonly lookup: NotificationLookupService,
    private readonly alerts: AlertStatesService,
  ) {}

  @Cron('0 25 */6 * * *')
  run(): Promise<void> {
    return scanAllTenants(this.dataSource, this, this.logger);
  }

  async scanTenant(tenantId: string, now = new Date()): Promise<void> {
    const { zone } = await this.lookup.locale(tenantId);
    const today = dayKeyInZone(now, zone);

    const overdue = await this.dataSource.query<DueInvoice[]>(
      `SELECT i.id, i.number, c.name AS party, w."branchId",
              i."dueDate"::text AS "dueDate",
              (i.total - i."returnedAmount" - i."paidAmount")::text AS remaining
         FROM sales_invoices i
         JOIN warehouses w ON w.id = i."warehouseId"
         LEFT JOIN customers c ON c.id = i."customerId"
        WHERE i."tenantId" = $1 AND i.status = 'issued' AND i."deletedAt" IS NULL
          AND i."dueDate" IS NOT NULL AND i."dueDate" < $2::date
          AND i.total - i."returnedAmount" - i."paidAmount" > 0.0005
        ORDER BY i."dueDate"`,
      [tenantId, today],
    );
    await this.alert(tenantId, 'customer_overdue', overdue, {
      permission: PERMS.CUSTOMER_PAYMENT_MANAGE.name,
      title: (n) =>
        n === 1
          ? 'فاتورة عميل تجاوزت تاريخ استحقاقها'
          : `${n} فواتير عملاء تجاوزت تاريخ استحقاقها`,
      body: 'مبالغ لم تُحصَّل بعد موعدها — تابع التحصيل',
      link: '/dashboard/sales',
    });

    const supplierDue = await this.dataSource.query<DueInvoice[]>(
      `SELECT i.id, i.number, s.name AS party, w."branchId",
              i."dueDate"::text AS "dueDate",
              (i.total - i."returnedAmount" - i."paidAmount")::text AS remaining
         FROM purchase_invoices i
         JOIN warehouses w ON w.id = i."warehouseId"
         JOIN suppliers s ON s.id = i."supplierId"
        WHERE i."tenantId" = $1 AND i.status = 'posted' AND i."deletedAt" IS NULL
          AND i."dueDate" IS NOT NULL AND i."dueDate" <= $2::date + $3::int
          AND i.total - i."returnedAmount" - i."paidAmount" > 0.0005
        ORDER BY i."dueDate"`,
      [tenantId, today, SUPPLIER_DAYS_AHEAD],
    );
    await this.alert(tenantId, 'supplier_due', supplierDue, {
      permission: PERMS.SUPPLIER_PAYMENT_MANAGE.name,
      title: (n) =>
        n === 1
          ? 'فاتورة مورد تستحق السداد'
          : `${n} فواتير موردين تستحق السداد`,
      body: `مستحقة خلال ${SUPPLIER_DAYS_AHEAD} أيام أو فات موعدها`,
      link: '/dashboard/purchasing',
    });
  }

  private async alert(
    tenantId: string,
    type: NotificationType,
    invoices: DueInvoice[],
    copy: {
      permission: string;
      title: (count: number) => string;
      body: string;
      link: string;
    },
  ): Promise<void> {
    const prefix = `${type}:`;
    const byKey = new Map(invoices.map((i) => [`${prefix}${i.id}`, i]));
    const raised = await this.alerts.sync(tenantId, prefix, [...byKey.keys()]);
    if (raised.length === 0) return;

    // مجمّعة لكل فرع: المقيَّد بفرع لا يرى فواتير غيره
    const byBranch = new Map<string, { keys: string[]; items: DueInvoice[] }>();
    for (const key of raised) {
      const invoice = byKey.get(key)!;
      const branch = invoice.branchId ?? '';
      const group = byBranch.get(branch) ?? { keys: [], items: [] };
      group.keys.push(key);
      group.items.push(invoice);
      byBranch.set(branch, group);
    }

    for (const [branch, { keys, items }] of byBranch) {
      const total = items.reduce((sum, i) => sum + Number(i.remaining), 0);
      const details: NotificationDetail[] = [
        { label: 'الإجمالي المتبقي', value: total, format: 'money' },
        ...items.slice(0, LISTED).map((i) => ({
          label: `${i.number}${i.party ? ` — ${i.party}` : ''} (استحقاق ${i.dueDate})`,
          value: Number(i.remaining),
          format: 'money' as const,
        })),
        ...(items.length > LISTED
          ? [{ label: 'وفواتير أخرى', value: items.length - LISTED }]
          : []),
      ];

      const result = await this.notifier.notifySafe({
        tenantId,
        type,
        severity: 'warning',
        title: copy.title(items.length),
        body: copy.body,
        details,
        link: copy.link,
        to: Audience.can(copy.permission, branch || null),
      });
      if (!result) await this.alerts.release(keys);
    }
  }
}
