// src/modules/notifications/scanners/low-stock.scanner.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PERMS } from '../../../common/constants/permissions';
import { Audience } from '../notification-audience.service';
import { NotifierService } from '../notifier.service';
import { AlertStatesService } from './alert-states.service';
import { type NotificationScanner, scanAllTenants } from './scanner.util';

const PREFIX = 'low_stock:';
/** أصناف تُسرد في تفاصيل الإشعار (والباقي عدد) */
const LISTED = 15;

interface LowRow {
  levelId: string;
  warehouseId: string;
  warehouseName: string;
  branchId: string | null;
  productName: string;
  sku: string;
  quantity: string;
  minQuantity: string;
}

/**
 * صنف وصل لحد إعادة الطلب في مخزن: تنبيه واحد عند وصوله (مجمّع لكل مخزن)،
 * ولا يتكرر حتى يرتفع الرصيد فوق الحد ثم ينزل من جديد.
 */
@Injectable()
export class LowStockScanner implements NotificationScanner {
  readonly label = 'تنبيهات نقص المخزون';
  private readonly logger = new Logger(LowStockScanner.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifier: NotifierService,
    private readonly alerts: AlertStatesService,
  ) {}

  @Cron('0 */30 * * * *')
  run(): Promise<void> {
    return scanAllTenants(this.dataSource, this, this.logger);
  }

  async scanTenant(tenantId: string): Promise<void> {
    // نفس تعريف "منخفض" في ملخص المخزون (StockService.summary)
    const rows = await this.dataSource.query<LowRow[]>(
      `SELECT l.id AS "levelId", l."warehouseId", w.name AS "warehouseName",
              w."branchId", p.name AS "productName", p.sku,
              l.quantity::text AS quantity, l."minQuantity"::text AS "minQuantity"
         FROM stock_levels l
         JOIN warehouses w ON w.id = l."warehouseId"
         JOIN products p ON p.id = l."productId"
        WHERE l."tenantId" = $1 AND l."minQuantity" IS NOT NULL
          AND l.quantity <= l."minQuantity"
          AND w."deletedAt" IS NULL AND w."isActive"
          AND p."deletedAt" IS NULL
        ORDER BY w.name, p.name`,
      [tenantId],
    );
    const byKey = new Map(rows.map((r) => [`${PREFIX}${r.levelId}`, r]));
    const raised = await this.alerts.sync(tenantId, PREFIX, [...byKey.keys()]);
    if (raised.length === 0) return;

    const byWarehouse = new Map<string, { keys: string[]; rows: LowRow[] }>();
    for (const key of raised) {
      const row = byKey.get(key)!;
      const group = byWarehouse.get(row.warehouseId) ?? { keys: [], rows: [] };
      group.keys.push(key);
      group.rows.push(row);
      byWarehouse.set(row.warehouseId, group);
    }

    for (const [warehouseId, { keys, rows: items }] of byWarehouse) {
      const warehouse = items[0];
      const single = items.length === 1;
      const result = await this.notifier.notifySafe({
        tenantId,
        type: 'low_stock',
        severity: items.some((i) => Number(i.quantity) <= 0)
          ? 'danger'
          : 'warning',
        title: single
          ? `«${items[0].productName}» وصل لحد إعادة الطلب`
          : `${items.length} أصناف وصلت لحد إعادة الطلب`,
        body: `في مخزن «${warehouse.warehouseName}»${single ? `: الرصيد ${Number(items[0].quantity)} والحد ${Number(items[0].minQuantity)}` : ''}`,
        details: [
          { label: 'المخزن', value: warehouse.warehouseName },
          ...items.slice(0, LISTED).map((item) => ({
            label: `${item.productName} (${item.sku})`,
            value: `الرصيد ${Number(item.quantity)} / الحد ${Number(item.minQuantity)}`,
          })),
          ...(items.length > LISTED
            ? [{ label: 'وأصناف أخرى', value: items.length - LISTED }]
            : []),
        ],
        entity: { type: 'warehouse', id: warehouseId },
        link: '/dashboard/inventory',
        to: [
          Audience.can(PERMS.WAREHOUSE_MANAGE.name, warehouse.branchId),
          Audience.can(PERMS.PURCHASE_MANAGE.name, warehouse.branchId),
        ],
      });
      if (!result) await this.alerts.release(keys);
    }
  }
}
