// src/modules/inventory/lots.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { DataSource } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { scopedWarehouseIds } from '../branches/branch-scope';
import { AssignLotDto, LotQueryDto, UpdateLotDto } from './dto/lots.dto';
import { StockLot, StockLotSource } from './entities/stock-lot.entity';
import { StockMovementType } from './entities/stock-movement.entity';
import { StockLotsService } from './stock-lots.service';

/** أيام قبل الانتهاء تُعدّ "قارب على الانتهاء" افتراضياً */
export const EXPIRING_SOON_DAYS = 30;

export type LotStatus = 'active' | 'expiring' | 'expired' | 'no_expiry';

export interface LotRow {
  id: string;
  lotNumber: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string | null;
  expiryDate: string | null;
  manufactureDate: string | null;
  source: StockLotSource;
  /** أيام حتى الانتهاء (سالب = منتهية منذ) — null بلا تاريخ */
  daysToExpiry: number | null;
  status: LotStatus;
  /** الرصيد في المخازن المرئية */
  quantity: number;
  /** القيمة بمتوسط تكلفة الصنف */
  value: number;
  warehouses: { warehouseId: string; name: string; quantity: number }[];
}

export interface LotTraceRow {
  movementId: string;
  occurredAt: Date;
  type: StockMovementType;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  referenceType: string | null;
  referenceId: string | null;
  /** رقم المستند المقروء (فاتورة، تحويل، أمر إنتاج...) */
  referenceNumber: string | null;
  /** العميل أو المورد (لسحب دفعة من السوق) */
  partyName: string | null;
}

export interface UnassignedRow {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  sku: string;
  /** الرصيد − مجموع دفعاته: موجب = رصيد بلا دفعة، سالب = خرج أكثر مما دخل بدفعات */
  unassigned: number;
}

/** أين يُقرأ رقم كل مستند يحرّك المخزون، ومن طرفه */
const REFERENCE_SQL: Record<string, { table: string; party?: string }> = {
  sales_invoice: {
    table: 'sales_invoices',
    party: `(SELECT c."name" FROM customers c WHERE c."id" = d."customerId")`,
  },
  sales_return: {
    table: 'sales_returns',
    party: `(SELECT c."name" FROM customers c WHERE c."id" = d."customerId")`,
  },
  purchase_invoice: {
    table: 'purchase_invoices',
    party: `(SELECT s."name" FROM suppliers s WHERE s."id" = d."supplierId")`,
  },
  purchase_return: {
    table: 'purchase_returns',
    party: `(SELECT s."name" FROM suppliers s WHERE s."id" = d."supplierId")`,
  },
  transfer: { table: 'stock_transfers' },
  stocktake: { table: 'stocktakes' },
  production_order: { table: 'production_orders' },
};

/**
 * الدفعات للقراءة والتتبع: الأرصدة وتواريخ الانتهاء، رحلة الدفعة من مصدرها
 * لكل من استلمها (للسحب من السوق)، والرصيد غير المعيّن وتعيينه لدفعة.
 * الكتابة على الأرصدة نفسها تبقى لـ StockService.apply وحده.
 */
@Injectable()
export class LotsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly allocator: StockLotsService,
  ) {}

  async findAll(
    tenantId: string,
    query: LotQueryDto,
  ): Promise<Paginated<LotRow>> {
    const { page, limit, skip } = resolvePagination(query);
    const days = query.days ?? EXPIRING_SOON_DAYS;
    const params: unknown[] = [tenantId];
    const where: string[] = [`l."tenantId" = $1`];
    const scoped = scopedWarehouseIds();
    let levelFilter = '';
    if (scoped) {
      params.push(scoped);
      levelFilter += ` AND lv."warehouseId" = ANY($${params.length}::uuid[])`;
    }
    if (query.warehouseId) {
      params.push(query.warehouseId);
      levelFilter += ` AND lv."warehouseId" = $${params.length}`;
    }
    if (query.productId) {
      params.push(query.productId);
      where.push(`l."productId" = $${params.length}`);
    }
    if (query.search) {
      params.push(`%${query.search.trim()}%`);
      where.push(
        `(l."lotNumber" ILIKE $${params.length} OR p."name" ILIKE $${params.length} OR p."sku" ILIKE $${params.length})`,
      );
    }
    const expiry = `(l."expiryDate" - CURRENT_DATE)`;
    const status = query.status ?? 'in_stock';
    if (status === 'expired') where.push(`l."expiryDate" < CURRENT_DATE`);
    if (status === 'expiring') {
      params.push(days);
      where.push(
        `l."expiryDate" >= CURRENT_DATE AND ${expiry} <= $${params.length}::int`,
      );
    }
    // بلا "all": الدفعات ذات الرصيد فقط (الفارغة تبقى للتتبع)
    const having =
      status === 'all' ? '' : `HAVING COALESCE(SUM(lv."quantity"), 0) > 0`;

    const base = `
      FROM stock_lots l
      JOIN products p ON p."id" = l."productId"
      LEFT JOIN units u ON u."id" = p."baseUnitId"
      LEFT JOIN inventory_items it ON it."tenantId" = l."tenantId" AND it."productId" = l."productId"
      LEFT JOIN stock_lot_levels lv ON lv."lotId" = l."id" ${levelFilter}
      LEFT JOIN warehouses w ON w."id" = lv."warehouseId"
      WHERE ${where.join(' AND ')}
      GROUP BY l."id", p."id", u."name", it."avgCost"
      ${having}`;

    const [{ total }] = await this.dataSource.query<{ total: string }[]>(
      `SELECT COUNT(*) AS "total" FROM (SELECT l."id" ${base}) x`,
      params,
    );
    const rows = await this.dataSource.query<
      (Omit<LotRow, 'quantity' | 'value' | 'status' | 'warehouses'> & {
        quantity: string;
        avgCost: string | null;
        warehouses: { warehouseId: string; name: string; quantity: string }[];
      })[]
    >(
      `SELECT l."id", l."lotNumber", l."productId", p."name" AS "productName",
              p."sku", u."name" AS "unit",
              to_char(l."expiryDate", 'YYYY-MM-DD') AS "expiryDate",
              to_char(l."manufactureDate", 'YYYY-MM-DD') AS "manufactureDate",
              l."source", ${expiry} AS "daysToExpiry",
              COALESCE(SUM(lv."quantity"), 0) AS "quantity", it."avgCost",
              COALESCE(json_agg(json_build_object(
                'warehouseId', lv."warehouseId", 'name', w."name", 'quantity', lv."quantity")
                ORDER BY w."name") FILTER (WHERE lv."quantity" > 0), '[]') AS "warehouses"
       ${base}
       ORDER BY l."expiryDate" ASC NULLS LAST, l."createdAt" ASC
       LIMIT ${limit} OFFSET ${skip}`,
      params,
    );

    return paginated(
      rows.map((row) => {
        const quantity = Number(row.quantity);
        const daysToExpiry =
          row.daysToExpiry === null ? null : Number(row.daysToExpiry);
        return {
          id: row.id,
          lotNumber: row.lotNumber,
          productId: row.productId,
          productName: row.productName,
          sku: row.sku,
          unit: row.unit,
          expiryDate: row.expiryDate,
          manufactureDate: row.manufactureDate,
          source: row.source,
          daysToExpiry,
          status: statusOf(daysToExpiry, days),
          quantity,
          value: new Decimal(quantity)
            .mul(row.avgCost ?? 0)
            .toDecimalPlaces(3)
            .toNumber(),
          warehouses: row.warehouses.map((w) => ({
            warehouseId: w.warehouseId,
            name: w.name,
            quantity: Number(w.quantity),
          })),
        };
      }),
      Number(total),
      page,
      limit,
    );
  }

  /** ملخص الصفحة: المنتهية والقاربة على الانتهاء وفيها رصيد */
  async summary(
    tenantId: string,
    days = EXPIRING_SOON_DAYS,
  ): Promise<{
    expired: number;
    expiredValue: number;
    expiring: number;
    expiringValue: number;
    lotsInStock: number;
  }> {
    const params: unknown[] = [tenantId, days];
    const scoped = scopedWarehouseIds();
    let filter = '';
    if (scoped) {
      params.push(scoped);
      filter = ` AND lv."warehouseId" = ANY($3::uuid[])`;
    }
    const [row] = await this.dataSource.query<Record<string, string>[]>(
      `WITH stock AS (
         SELECT l."id", l."expiryDate", SUM(lv."quantity") AS "quantity",
                SUM(lv."quantity") * COALESCE(MAX(it."avgCost"), 0) AS "value"
           FROM stock_lots l
           JOIN stock_lot_levels lv ON lv."lotId" = l."id" ${filter}
           LEFT JOIN inventory_items it ON it."tenantId" = l."tenantId" AND it."productId" = l."productId"
          WHERE l."tenantId" = $1
          GROUP BY l."id"
         HAVING SUM(lv."quantity") > 0)
       SELECT COUNT(*) AS "lotsInStock",
              COUNT(*) FILTER (WHERE "expiryDate" < CURRENT_DATE) AS "expired",
              COALESCE(SUM("value") FILTER (WHERE "expiryDate" < CURRENT_DATE), 0) AS "expiredValue",
              COUNT(*) FILTER (WHERE "expiryDate" >= CURRENT_DATE
                                 AND "expiryDate" - CURRENT_DATE <= $2) AS "expiring",
              COALESCE(SUM("value") FILTER (WHERE "expiryDate" >= CURRENT_DATE
                                 AND "expiryDate" - CURRENT_DATE <= $2), 0) AS "expiringValue"
         FROM stock`,
      params,
    );
    return {
      lotsInStock: Number(row.lotsInStock),
      expired: Number(row.expired),
      expiredValue: roundValue(row.expiredValue),
      expiring: Number(row.expiring),
      expiringValue: roundValue(row.expiringValue),
    };
  }

  /** الدفعة ورحلتها: من أين دخلت، وأين خرجت ولمن */
  async trace(
    id: string,
    tenantId: string,
  ): Promise<{ lot: LotRow; movements: LotTraceRow[] }> {
    const lot = await this.lotOf(id, tenantId);
    const { data } = await this.findAll(tenantId, {
      productId: lot.productId,
      search: lot.lotNumber,
      status: 'all',
      limit: 50,
    });
    const row = data.find((r) => r.id === id);
    if (!row) throw new NotFoundException('الدفعة غير موجودة');

    const params: unknown[] = [tenantId, id];
    const scoped = scopedWarehouseIds();
    let filter = '';
    if (scoped) {
      params.push(scoped);
      filter = ` AND m."warehouseId" = ANY($3::uuid[])`;
    }
    const movements = await this.dataSource.query<
      (Omit<LotTraceRow, 'quantity' | 'referenceNumber' | 'partyName'> & {
        quantity: string;
      })[]
    >(
      `SELECT m."id" AS "movementId", m."occurredAt", m."type", m."warehouseId",
              w."name" AS "warehouseName", ml."quantity",
              m."referenceType", m."referenceId"
         FROM stock_movement_lots ml
         JOIN stock_movements m ON m."id" = ml."movementId"
         JOIN warehouses w ON w."id" = m."warehouseId"
        WHERE ml."tenantId" = $1 AND ml."lotId" = $2 ${filter}
        ORDER BY m."occurredAt" ASC, m."createdAt" ASC`,
      params,
    );
    const references = await this.referenceNumbers(
      movements.map((m) => ({ type: m.referenceType, id: m.referenceId })),
    );
    return {
      lot: row,
      movements: movements.map((m) => {
        const ref = references.get(`${m.referenceType}:${m.referenceId}`);
        return {
          ...m,
          quantity: Number(m.quantity),
          referenceNumber: ref?.number ?? null,
          partyName: ref?.party ?? null,
        };
      }),
    };
  }

  /** دفعات صنف ذات رصيد في مخزن (لاختيار دفعة في مستند) بترتيب FEFO */
  async available(
    tenantId: string,
    productId: string,
    warehouseId: string,
  ): Promise<
    {
      lotId: string;
      lotNumber: string;
      expiryDate: string | null;
      quantity: number;
      expired: boolean;
    }[]
  > {
    const rows = await this.dataSource.query<
      {
        lotId: string;
        lotNumber: string;
        expiryDate: string | null;
        quantity: string;
        expired: boolean;
      }[]
    >(
      `SELECT l."id" AS "lotId", l."lotNumber",
              to_char(l."expiryDate", 'YYYY-MM-DD') AS "expiryDate",
              lv."quantity", COALESCE(l."expiryDate" < CURRENT_DATE, false) AS "expired"
         FROM stock_lot_levels lv
         JOIN stock_lots l ON l."id" = lv."lotId"
        WHERE l."tenantId" = $1 AND lv."productId" = $2 AND lv."warehouseId" = $3
          AND lv."quantity" > 0
        ORDER BY (l."expiryDate" IS NOT NULL AND l."expiryDate" < CURRENT_DATE) ASC,
                 l."expiryDate" ASC NULLS LAST, l."createdAt" ASC`,
      [tenantId, productId, warehouseId],
    );
    return rows.map((r) => ({ ...r, quantity: Number(r.quantity) }));
  }

  /** الأصناف المتتبعة التي لها رصيد بلا دفعة (أو خرج منها أكثر مما دخل بدفعات) */
  async unassigned(
    tenantId: string,
    warehouseId?: string,
  ): Promise<UnassignedRow[]> {
    const params: unknown[] = [tenantId];
    let filter = '';
    const scoped = scopedWarehouseIds();
    if (scoped) {
      params.push(scoped);
      filter += ` AND s."warehouseId" = ANY($${params.length}::uuid[])`;
    }
    if (warehouseId) {
      params.push(warehouseId);
      filter += ` AND s."warehouseId" = $${params.length}`;
    }
    const rows = await this.dataSource.query<
      (Omit<UnassignedRow, 'unassigned'> & { unassigned: string })[]
    >(
      `SELECT s."warehouseId", w."name" AS "warehouseName", s."productId",
              p."name" AS "productName", p."sku",
              s."quantity" - COALESCE((SELECT SUM(lv."quantity") FROM stock_lot_levels lv
                 WHERE lv."warehouseId" = s."warehouseId" AND lv."productId" = s."productId"), 0)
                AS "unassigned"
         FROM stock_levels s
         JOIN products p ON p."id" = s."productId" AND p."trackLots" = true AND p."deletedAt" IS NULL
         JOIN warehouses w ON w."id" = s."warehouseId"
        WHERE s."tenantId" = $1 ${filter}
          AND s."quantity" - COALESCE((SELECT SUM(lv."quantity") FROM stock_lot_levels lv
                 WHERE lv."warehouseId" = s."warehouseId" AND lv."productId" = s."productId"), 0) <> 0
        ORDER BY w."name", p."name"`,
      params,
    );
    return rows.map((r) => ({ ...r, unassigned: Number(r.unassigned) }));
  }

  /**
   * تعيين رصيد غير معيّن لدفعة (رصيد كان قبل تفعيل التتبع): الرصيد لا يتغير،
   * ويُسجَّل في الدفتر حركة بكمية صفر توزيعها +الدفعة −غير المعيّن.
   */
  async assign(
    dto: AssignLotDto,
    tenantId: string,
    userId?: string,
  ): Promise<LotRow> {
    const lotId = await this.dataSource.transaction(async (manager) => {
      const [product] = await manager.query<
        {
          id: string;
          name: string;
          trackLots: boolean;
          shelfLifeDays: number | null;
        }[]
      >(
        `SELECT "id", "name", "trackLots", "shelfLifeDays" FROM products
          WHERE "id" = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL`,
        [dto.productId, tenantId],
      );
      if (!product) throw new NotFoundException('الصنف غير موجود');
      if (!product.trackLots) {
        throw new BadRequestException('الصنف لا يتتبع دفعاته');
      }
      // قفل الصنف كأي حركة مخزون
      await manager.query(
        `SELECT 1 FROM inventory_items WHERE "tenantId" = $1 AND "productId" = $2 FOR UPDATE`,
        [tenantId, dto.productId],
      );
      const [level] = await manager.query<{ unassigned: string }[]>(
        `SELECT s."quantity" - COALESCE((SELECT SUM(lv."quantity") FROM stock_lot_levels lv
                  WHERE lv."warehouseId" = s."warehouseId" AND lv."productId" = s."productId"), 0)
                  AS "unassigned"
           FROM stock_levels s
          WHERE s."tenantId" = $1 AND s."warehouseId" = $2 AND s."productId" = $3`,
        [tenantId, dto.warehouseId, dto.productId],
      );
      const free = new Decimal(level?.unassigned ?? 0);
      if (free.lt(dto.quantity)) {
        throw new BadRequestException(
          `الرصيد غير المعيّن لـ "${product.name}" في هذا المخزن ${free.toNumber()} فقط`,
        );
      }

      const lot = await this.allocator.upsertLot(
        manager,
        tenantId,
        dto.productId,
        {
          lotNumber: dto.lotNumber,
          expiryDate: dto.expiryDate ?? null,
          manufactureDate: dto.manufactureDate ?? null,
          source: StockLotSource.OPENING,
        },
        product.shelfLifeDays,
        new Date(),
      );
      const [movement] = await manager.query<{ id: string }[]>(
        `INSERT INTO stock_movements
           ("tenantId", "warehouseId", "productId", "type", "quantity", "unitCost",
            "balanceAfter", "referenceType", "note", "createdById")
         SELECT $1, $2, $3, $4, 0, COALESCE(it."avgCost", 0), s."quantity", 'lot_assignment', $5, $6
           FROM stock_levels s
           LEFT JOIN inventory_items it ON it."tenantId" = s."tenantId" AND it."productId" = s."productId"
          WHERE s."tenantId" = $1 AND s."warehouseId" = $2 AND s."productId" = $3
         RETURNING "id"`,
        [
          tenantId,
          dto.warehouseId,
          dto.productId,
          StockMovementType.LOT_ASSIGNMENT,
          `تعيين ${dto.quantity} للدفعة ${lot.lotNumber}`,
          userId ?? null,
        ],
      );
      const quantity = new Decimal(dto.quantity).toFixed(4);
      await manager.query(
        `INSERT INTO stock_movement_lots ("tenantId", "movementId", "lotId", "quantity")
         VALUES ($1, $2, $3, $4), ($1, $2, NULL, -$4::numeric)`,
        [tenantId, movement.id, lot.id, quantity],
      );
      await manager.query(
        `INSERT INTO stock_lot_levels ("tenantId", "warehouseId", "productId", "lotId", "quantity")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("warehouseId", "lotId")
         DO UPDATE SET "quantity" = stock_lot_levels."quantity" + EXCLUDED."quantity", "updatedAt" = now()`,
        [tenantId, dto.warehouseId, dto.productId, lot.id, quantity],
      );
      return lot.id;
    });
    return (await this.trace(lotId, tenantId)).lot;
  }

  async update(
    id: string,
    dto: UpdateLotDto,
    tenantId: string,
  ): Promise<LotRow> {
    await this.lotOf(id, tenantId);
    await this.dataSource.query(
      `UPDATE stock_lots
          SET "expiryDate" = CASE WHEN $3 THEN $4::date ELSE "expiryDate" END,
              "manufactureDate" = CASE WHEN $5 THEN $6::date ELSE "manufactureDate" END,
              "note" = CASE WHEN $7 THEN $8 ELSE "note" END,
              "updatedAt" = now()
        WHERE "id" = $1 AND "tenantId" = $2`,
      [
        id,
        tenantId,
        dto.expiryDate !== undefined,
        dto.expiryDate ?? null,
        dto.manufactureDate !== undefined,
        dto.manufactureDate ?? null,
        dto.note !== undefined,
        dto.note ?? null,
      ],
    );
    return (await this.trace(id, tenantId)).lot;
  }

  private async lotOf(id: string, tenantId: string): Promise<StockLot> {
    const lot = await this.dataSource.manager.findOne(StockLot, {
      where: { id, tenantId },
    });
    if (!lot) throw new NotFoundException('الدفعة غير موجودة');
    return lot;
  }

  /** أرقام المستندات وأطرافها دفعة واحدة لكل نوع */
  private async referenceNumbers(
    refs: { type: string | null; id: string | null }[],
  ): Promise<Map<string, { number: string | null; party: string | null }>> {
    const result = new Map<
      string,
      { number: string | null; party: string | null }
    >();
    const byType = new Map<string, Set<string>>();
    for (const ref of refs) {
      if (!ref.type || !ref.id || !REFERENCE_SQL[ref.type]) continue;
      if (!byType.has(ref.type)) byType.set(ref.type, new Set());
      byType.get(ref.type)!.add(ref.id);
    }
    for (const [type, ids] of byType) {
      const { table, party } = REFERENCE_SQL[type];
      const rows = await this.dataSource.query<
        { id: string; number: string | null; party: string | null }[]
      >(
        `SELECT d."id", d."number", ${party ?? 'NULL'} AS "party"
           FROM ${table} d WHERE d."id" = ANY($1::uuid[])`,
        [[...ids]],
      );
      for (const row of rows) {
        result.set(`${type}:${row.id}`, {
          number: row.number,
          party: row.party,
        });
      }
    }
    return result;
  }
}

function statusOf(daysToExpiry: number | null, soon: number): LotStatus {
  if (daysToExpiry === null) return 'no_expiry';
  if (daysToExpiry < 0) return 'expired';
  if (daysToExpiry <= soon) return 'expiring';
  return 'active';
}

function roundValue(value: string | number | null): number {
  return new Decimal(value ?? 0).toDecimalPlaces(3).toNumber();
}
