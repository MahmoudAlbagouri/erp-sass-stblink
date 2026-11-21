// src/modules/manufacturing/planning.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DataSource } from 'typeorm';
import { scopedWarehouseIds } from '../branches/branch-scope';
import {
  ProductProcurement,
  ProductType,
} from '../catalog/entities/product.entity';
import { PurchaseInvoicesService } from '../purchasing/purchase-invoices.service';
import { BomsService, MAX_BOM_DEPTH } from './boms.service';
import {
  DateRangeQueryDto,
  MrpPurchaseDraftsDto,
  MrpQueryDto,
} from './dto/manufacturing.dto';
import { BomKind } from './entities/bom.entity';

export interface MrpRow {
  productId: string;
  name: string;
  sku: string;
  unit: string | null;
  procurement: ProductProcurement;
  /** للخامة: ما تطلبه الأوامر؛ للمنتج: ما ينقص عن حد إعادة الطلب */
  required: number;
  onHand: number;
  /** في الطريق: مسودات شراء، وأوامر إنتاج مفتوحة للصنف نفسه */
  incoming: number;
  shortage: number;
  action: 'buy' | 'make' | 'none';
  /** آخر مورد اشتُري منه، ومدة توريده */
  supplierId: string | null;
  supplierName: string | null;
  leadTimeDays: number | null;
  lastCost: number;
  /** أقرب تاريخ يُحتاج فيه (أقرب بدء أمر) */
  needDate: string | null;
  /** آخر يوم للطلب = تاريخ الحاجة − مدة التوريد */
  orderBy: string | null;
  /** الأوامر التي تحتاجه */
  orders: string[];
  level: number;
}

export interface CapacityDay {
  date: string;
  available: number;
  load: number;
  utilization: number;
}

export interface CapacityRow {
  workCenterId: string;
  code: string;
  name: string;
  available: number;
  load: number;
  utilization: number;
  overloadedDays: number;
  days: CapacityDay[];
}

const MAX_RANGE_DAYS = 92;

/**
 * تخطيط المصنع وتقاريره:
 *  - تخطيط الاحتياجات (MRP) متعدد المستويات: طلب الأوامر المفتوحة (ونقص حد
 *    إعادة الطلب) يُفك عبر القوائم، ويُطرح المتاح والقادم، فيخرج لكل صنف: كم
 *    ينقص، ويُشترى أم يُصنَّع، ومن أي مورد ومتى يُطلب.
 *  - حمل مراكز العمل: دقائق الخطوات المتبقية موزعة على أيام عمل كل مركز مقابل
 *    طاقته.
 *  - أداء المصنع: التكلفة المخططة مقابل الفعلية، الهالك وأسبابه، التوقف
 *    وأسبابه، وكفاءة كل مركز (OEE تقريبية).
 */
@Injectable()
export class PlanningService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly boms: BomsService,
    private readonly purchases: PurchaseInvoicesService,
  ) {}

  // ══════════════════════════ MRP ══════════════════════════

  async mrp(tenantId: string, query: MrpQueryDto): Promise<MrpRow[]> {
    const orderIds = query.orderIds
      ? query.orderIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : null;
    const warehouseIds = query.warehouseId
      ? [query.warehouseId]
      : scopedWarehouseIds();

    // ─── الطلب: خامات الأوامر المفتوحة (المتبقي منها) ───
    const params: unknown[] = [tenantId];
    let orderFilter = '';
    if (orderIds) {
      params.push(orderIds);
      orderFilter = ` AND o."id" = ANY($2::uuid[])`;
    }
    const demand = await this.dataSource.query<
      {
        productId: string;
        quantity: string;
        number: string;
        startDate: string | null;
      }[]
    >(
      `SELECT m."productId",
              GREATEST(m."plannedQuantity" - m."issuedQuantity" + m."returnedQuantity", 0) AS "quantity",
              o."number", to_char(COALESCE(o."plannedStartDate", CURRENT_DATE), 'YYYY-MM-DD') AS "startDate"
         FROM production_order_materials m
         JOIN production_orders o ON o."id" = m."orderId"
        WHERE o."tenantId" = $1 AND o."deletedAt" IS NULL
          AND o."status" IN ('draft','released','in_progress') ${orderFilter}`,
      params,
    );

    const gross = new Map<string, Decimal>();
    const orders = new Map<string, Set<string>>();
    const needDate = new Map<string, string>();
    const level = new Map<string, number>();
    const add = (
      productId: string,
      quantity: Decimal,
      number: string | null,
      date: string | null,
      depth: number,
    ) => {
      if (quantity.lte(0)) return;
      gross.set(
        productId,
        (gross.get(productId) ?? new Decimal(0)).plus(quantity),
      );
      if (number) {
        if (!orders.has(productId)) orders.set(productId, new Set());
        orders.get(productId)!.add(number);
      }
      if (
        date &&
        (!needDate.has(productId) || date < needDate.get(productId)!)
      ) {
        needDate.set(productId, date);
      }
      level.set(productId, Math.max(level.get(productId) ?? 0, depth));
    };
    for (const row of demand) {
      add(
        row.productId,
        new Decimal(row.quantity),
        row.number,
        row.startDate,
        1,
      );
    }

    // ─── نقص حد إعادة الطلب (اختياري) ───
    if (query.includeReorder === 'true') {
      const wParams: unknown[] = [tenantId];
      let wFilter = '';
      if (warehouseIds) {
        wParams.push(warehouseIds);
        wFilter = ` AND s."warehouseId" = ANY($2::uuid[])`;
      }
      const low = await this.dataSource.query<
        { productId: string; shortfall: string }[]
      >(
        `SELECT s."productId", SUM(s."minQuantity" - s."quantity") AS "shortfall"
           FROM stock_levels s
          WHERE s."tenantId" = $1 AND s."minQuantity" IS NOT NULL
            AND s."quantity" < s."minQuantity" ${wFilter}
          GROUP BY s."productId"`,
        wParams,
      );
      for (const row of low) {
        add(row.productId, new Decimal(row.shortfall), null, null, 0);
      }
    }

    if (!gross.size) return [];

    // ─── فك المستويات: المصنَّع الناقص يصير طلباً على مكوّناته ───
    const exploded = new Map<string, Decimal>();
    for (let depth = 0; depth < MAX_BOM_DEPTH; depth++) {
      const supply = await this.supply(
        tenantId,
        [...gross.keys()],
        warehouseIds,
      );
      const products = await this.boms.productsOf([...gross.keys()], tenantId);
      let changed = false;
      for (const [productId, required] of [...gross.entries()]) {
        const product = products.get(productId)!;
        if (product.procurement !== ProductProcurement.MAKE) continue;
        const available = supply.onHand.get(productId) ?? new Decimal(0);
        const incoming = supply.incoming.get(productId) ?? new Decimal(0);
        const shortage = Decimal.max(
          required.minus(available).minus(incoming),
          0,
        );
        const done = exploded.get(productId) ?? new Decimal(0);
        const delta = shortage.minus(done);
        if (delta.lte(0)) continue;
        const bom = await this.boms.defaultFor(
          productId,
          BomKind.PRODUCTION,
          tenantId,
        );
        if (!bom) continue;
        exploded.set(productId, shortage);
        changed = true;
        for (const requirement of this.boms.requirementsOf(bom, delta)) {
          add(
            requirement.productId,
            requirement.quantity,
            null,
            needDate.get(productId) ?? null,
            (level.get(productId) ?? 0) + 1,
          );
          for (const number of orders.get(productId) ?? []) {
            if (!orders.has(requirement.productId)) {
              orders.set(requirement.productId, new Set());
            }
            orders.get(requirement.productId)!.add(number);
          }
        }
      }
      if (!changed) break;
    }

    // ─── النتيجة ───
    const ids = [...gross.keys()];
    const [supply, products, suppliers] = await Promise.all([
      this.supply(tenantId, ids, warehouseIds),
      this.boms.productsOf(ids, tenantId),
      this.lastSuppliers(tenantId, ids),
    ]);
    const rows: MrpRow[] = [];
    for (const productId of ids) {
      const product = products.get(productId)!;
      if (product.type !== ProductType.STOCKED) continue;
      const required = gross.get(productId)!;
      const onHand = supply.onHand.get(productId) ?? new Decimal(0);
      const incoming = supply.incoming.get(productId) ?? new Decimal(0);
      const shortage = Decimal.max(required.minus(onHand).minus(incoming), 0);
      const supplier = suppliers.get(productId);
      const date = needDate.get(productId) ?? null;
      const make = product.procurement === ProductProcurement.MAKE;
      const lead = make ? 0 : (supplier?.leadTimeDays ?? null);
      rows.push({
        productId,
        name: product.name,
        sku: product.sku,
        unit: product.baseUnit?.name ?? null,
        procurement: product.procurement,
        required: round4(required),
        onHand: round4(onHand),
        incoming: round4(incoming),
        shortage: round4(shortage),
        action: shortage.lte(0) ? 'none' : make ? 'make' : 'buy',
        supplierId: supplier?.supplierId ?? null,
        supplierName: supplier?.supplierName ?? null,
        leadTimeDays: supplier?.leadTimeDays ?? null,
        lastCost: supplier ? Number(supplier.lastCost) : 0,
        needDate: date,
        orderBy: date && lead !== null ? addDays(date, -lead) : date,
        orders: [...(orders.get(productId) ?? [])],
        level: level.get(productId) ?? 0,
      });
    }
    return rows.sort(
      (a, b) =>
        Number(b.shortage > 0) - Number(a.shortage > 0) ||
        (a.orderBy ?? '9999').localeCompare(b.orderBy ?? '9999') ||
        a.name.localeCompare(b.name),
    );
  }

  /** مسودات فواتير شراء من نقص التخطيط: مسودة لكل مورد */
  async createPurchaseDrafts(
    dto: MrpPurchaseDraftsDto,
    tenantId: string,
    userId?: string,
  ): Promise<{ id: string; number: string; supplierId: string }[]> {
    const bySupplier = new Map<string, typeof dto.lines>();
    for (const line of dto.lines) {
      if (!bySupplier.has(line.supplierId)) bySupplier.set(line.supplierId, []);
      bySupplier.get(line.supplierId)!.push(line);
    }
    const costs = await this.dataSource.query<
      { productId: string; lastCost: string }[]
    >(
      `SELECT "productId", "lastCost" FROM inventory_items
        WHERE "tenantId" = $1 AND "productId" = ANY($2::uuid[])`,
      [tenantId, dto.lines.map((l) => l.productId)],
    );
    const lastCost = new Map(
      costs.map((c) => [c.productId, Number(c.lastCost)]),
    );
    const today = new Date().toISOString().slice(0, 10);

    const created: { id: string; number: string; supplierId: string }[] = [];
    for (const [supplierId, lines] of bySupplier) {
      const invoice = await this.purchases.create(
        {
          supplierId,
          warehouseId: dto.warehouseId,
          invoiceDate: today,
          // تاريخ الطلب اليوم: منه تُقاس مدة التوريد الفعلية عند الاستلام
          orderDate: today,
          note: 'من تخطيط احتياجات المصنع (MRP)',
          lines: lines.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
            unitPrice: lastCost.get(line.productId) ?? 0,
          })),
        },
        tenantId,
        userId,
      );
      created.push({ id: invoice.id, number: invoice.number, supplierId });
    }
    return created;
  }

  // ══════════════════════════ الطاقة ══════════════════════════

  async capacity(
    tenantId: string,
    query: DateRangeQueryDto,
  ): Promise<CapacityRow[]> {
    const days = dateRange(query.from, query.to);
    if (days.length > MAX_RANGE_DAYS) {
      throw new BadRequestException(`المدة القصوى ${MAX_RANGE_DAYS} يوماً`);
    }
    const params: unknown[] = [tenantId];
    let centerFilter = '';
    if (query.workCenterId) {
      params.push(query.workCenterId);
      centerFilter = ` AND c."id" = $2`;
    }
    const centers = await this.dataSource.query<
      {
        id: string;
        code: string;
        name: string;
        parallelUnits: number;
        hoursPerDay: string;
        workingDays: number[];
      }[]
    >(
      `SELECT c."id", c."code", c."name", c."parallelUnits", c."hoursPerDay", c."workingDays"
         FROM work_centers c
        WHERE c."tenantId" = $1 AND c."deletedAt" IS NULL AND c."isActive" = true ${centerFilter}
        ORDER BY c."code"`,
      params,
    );
    const operations = await this.dataSource.query<
      {
        workCenterId: string;
        remaining: string;
        start: string;
        end: string;
      }[]
    >(
      `SELECT op."workCenterId",
              GREATEST(op."plannedSetupMinutes" + op."plannedRunMinutes"
                       - op."actualSetupMinutes" - op."actualRunMinutes", 0) AS "remaining",
              to_char(GREATEST(COALESCE(o."plannedStartDate", CURRENT_DATE), CURRENT_DATE), 'YYYY-MM-DD') AS "start",
              to_char(GREATEST(COALESCE(o."plannedEndDate", o."plannedStartDate", CURRENT_DATE), CURRENT_DATE), 'YYYY-MM-DD') AS "end"
         FROM production_order_operations op
         JOIN production_orders o ON o."id" = op."orderId"
        WHERE op."tenantId" = $1 AND op."status" <> 'done'
          AND o."status" IN ('draft','released','in_progress') AND o."deletedAt" IS NULL`,
      [tenantId],
    );

    return centers.map((center) => {
      const working = (date: string) =>
        center.workingDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
      const perDay = new Decimal(center.parallelUnits)
        .mul(center.hoursPerDay)
        .mul(60);
      const load = new Map<string, Decimal>();
      for (const op of operations.filter((o) => o.workCenterId === center.id)) {
        const remaining = new Decimal(op.remaining);
        if (remaining.lte(0)) continue;
        const window = dateRange(
          op.start,
          op.end < op.start ? op.start : op.end,
        );
        const workDays = window.filter(working);
        const spread = workDays.length ? workDays : [window[0]];
        const share = remaining.div(spread.length);
        for (const day of spread) {
          load.set(day, (load.get(day) ?? new Decimal(0)).plus(share));
        }
      }
      const rows = days.map((date) => {
        const available = working(date) ? perDay : new Decimal(0);
        const used = load.get(date) ?? new Decimal(0);
        return {
          date,
          available: round2(available),
          load: round2(used),
          utilization: available.gt(0)
            ? round2(used.div(available).mul(100))
            : used.gt(0)
              ? 999
              : 0,
        };
      });
      const available = rows.reduce((s, r) => s + r.available, 0);
      const used = rows.reduce((s, r) => s + r.load, 0);
      return {
        workCenterId: center.id,
        code: center.code,
        name: center.name,
        available: Number(available.toFixed(2)),
        load: Number(used.toFixed(2)),
        utilization:
          available > 0 ? Number(((used / available) * 100).toFixed(2)) : 0,
        overloadedDays: rows.filter((r) => r.utilization > 100).length,
        days: rows,
      };
    });
  }

  // ══════════════════════════ الأداء ══════════════════════════

  async performance(tenantId: string, query: DateRangeQueryDto) {
    const params = [tenantId, query.from, query.to];
    const [products, downtime, centers, scrap] = await Promise.all([
      this.dataSource.query<Record<string, string>[]>(
        `SELECT o."productId", p."name", p."sku",
                COUNT(*) AS "orders",
                SUM(o."plannedQuantity") AS "planned",
                SUM(o."producedQuantity") AS "produced",
                SUM(o."scrapQuantity") AS "scrap",
                SUM(o."materialCost" + o."laborCost" + o."overheadCost" - o."byproductValue") AS "actualCost",
                SUM(o."plannedMaterialCost" + o."plannedLaborCost" + o."plannedOverheadCost") AS "plannedCost",
                AVG(EXTRACT(EPOCH FROM (o."completedAt" - o."startedAt")) / 3600) AS "leadHours"
           FROM production_orders o
           JOIN products p ON p."id" = o."productId"
          WHERE o."tenantId" = $1 AND o."status" = 'completed'
            AND o."completedAt"::date BETWEEN $2::date AND $3::date
          GROUP BY o."productId", p."name", p."sku"
          ORDER BY SUM(o."receivedValue") DESC`,
        params,
      ),
      this.dataSource.query<Record<string, string>[]>(
        `SELECT l."workCenterId", c."name" AS "workCenter", l."downtimeReason" AS "reason",
                SUM(l."minutes") AS "minutes", COUNT(*) AS "events"
           FROM production_time_logs l
           JOIN work_centers c ON c."id" = l."workCenterId"
          WHERE l."tenantId" = $1 AND l."kind" = 'downtime' AND l."endedAt" IS NOT NULL
            AND l."startedAt"::date BETWEEN $2::date AND $3::date
          GROUP BY l."workCenterId", c."name", l."downtimeReason"
          ORDER BY SUM(l."minutes") DESC`,
        params,
      ),
      this.dataSource.query<Record<string, string>[]>(
        `SELECT c."id" AS "workCenterId", c."name",
                COALESCE(SUM(l."minutes") FILTER (WHERE l."kind" = 'setup'), 0) AS "setup",
                COALESCE(SUM(l."minutes") FILTER (WHERE l."kind" = 'run'), 0) AS "run",
                COALESCE(SUM(l."minutes") FILTER (WHERE l."kind" = 'downtime'), 0) AS "downtime",
                COALESCE(SUM(l."quantity"), 0) AS "good",
                COALESCE(SUM(l."scrapQuantity"), 0) AS "scrap",
                COALESCE((SELECT SUM(op."plannedRunMinutes" * LEAST(op."quantityDone" / NULLIF(o."plannedQuantity", 0), 1))
                   FROM production_order_operations op
                   JOIN production_orders o ON o."id" = op."orderId"
                  WHERE op."workCenterId" = c."id" AND op."finishedAt"::date BETWEEN $2::date AND $3::date), 0) AS "standardRun",
                COALESCE((SELECT SUM(op."actualRunMinutes") FROM production_order_operations op
                  WHERE op."workCenterId" = c."id" AND op."finishedAt"::date BETWEEN $2::date AND $3::date
                    AND op."quantityDone" > 0), 0) AS "actualRun"
           FROM work_centers c
           LEFT JOIN production_time_logs l ON l."workCenterId" = c."id" AND l."endedAt" IS NOT NULL
                 AND l."startedAt"::date BETWEEN $2::date AND $3::date
          WHERE c."tenantId" = $1 AND c."deletedAt" IS NULL
          GROUP BY c."id", c."name"
          ORDER BY c."name"`,
        params,
      ),
      this.dataSource.query<Record<string, string>[]>(
        `SELECT "scrapReason" AS "reason", SUM("scrapQuantity") AS "quantity", COUNT(*) AS "events"
           FROM (
             SELECT "scrapReason", "scrapQuantity" FROM production_transactions
              WHERE "tenantId" = $1 AND "scrapQuantity" > 0
                AND "occurredAt"::date BETWEEN $2::date AND $3::date
             UNION ALL
             SELECT "scrapReason", "scrapQuantity" FROM production_time_logs
              WHERE "tenantId" = $1 AND "scrapQuantity" > 0
                AND "startedAt"::date BETWEEN $2::date AND $3::date) s
          GROUP BY "scrapReason"
          ORDER BY SUM("scrapQuantity") DESC`,
        params,
      ),
    ]);

    return {
      products: products.map((r) => {
        const produced = Number(r.produced);
        const scrap = Number(r.scrap);
        const actual = Number(r.actualCost);
        const planned = Number(r.plannedCost);
        const plannedQty = Number(r.planned);
        const actualUnit = produced > 0 ? actual / produced : 0;
        const plannedUnit = plannedQty > 0 ? planned / plannedQty : 0;
        return {
          productId: r.productId,
          name: r.name,
          sku: r.sku,
          orders: Number(r.orders),
          plannedQuantity: plannedQty,
          producedQuantity: produced,
          scrapQuantity: scrap,
          scrapRate: produced + scrap > 0 ? pct(scrap / (produced + scrap)) : 0,
          actualCost: Number(actual.toFixed(3)),
          actualUnitCost: Number(actualUnit.toFixed(4)),
          plannedUnitCost: Number(plannedUnit.toFixed(4)),
          costVariance:
            plannedUnit > 0 ? pct((actualUnit - plannedUnit) / plannedUnit) : 0,
          avgLeadHours: r.leadHours
            ? Number(Number(r.leadHours).toFixed(1))
            : null,
        };
      }),
      downtime: downtime.map((r) => ({
        workCenterId: r.workCenterId,
        workCenter: r.workCenter,
        reason: r.reason,
        minutes: Number(Number(r.minutes).toFixed(1)),
        events: Number(r.events),
      })),
      workCenters: centers.map((r) => {
        const setup = Number(r.setup);
        const run = Number(r.run);
        const down = Number(r.downtime);
        const good = Number(r.good);
        const scrapQty = Number(r.scrap);
        const availability =
          setup + run + down > 0 ? (setup + run) / (setup + run + down) : null;
        const performance =
          Number(r.actualRun) > 0
            ? Math.min(Number(r.standardRun) / Number(r.actualRun), 1.5)
            : null;
        const quality = good + scrapQty > 0 ? good / (good + scrapQty) : null;
        return {
          workCenterId: r.workCenterId,
          name: r.name,
          setupMinutes: Number(setup.toFixed(1)),
          runMinutes: Number(run.toFixed(1)),
          downtimeMinutes: Number(down.toFixed(1)),
          goodQuantity: good,
          scrapQuantity: scrapQty,
          availability: availability === null ? null : pct(availability),
          performance: performance === null ? null : pct(performance),
          quality: quality === null ? null : pct(quality),
          oee:
            availability !== null && performance !== null && quality !== null
              ? pct(availability * Math.min(performance, 1) * quality)
              : null,
        };
      }),
      scrap: scrap.map((r) => ({
        reason: r.reason,
        quantity: Number(r.quantity),
        events: Number(r.events),
      })),
    };
  }

  // ══════════════════════════ داخلي ══════════════════════════

  /** المتاح (الرصيد) والقادم (مسودات شراء + أوامر إنتاج مفتوحة) لكل صنف */
  private async supply(
    tenantId: string,
    productIds: string[],
    warehouseIds: string[] | null,
  ): Promise<{ onHand: Map<string, Decimal>; incoming: Map<string, Decimal> }> {
    const params: unknown[] = [tenantId, productIds];
    let filter = '';
    if (warehouseIds) {
      params.push(warehouseIds);
      filter = ` AND "warehouseId" = ANY($3::uuid[])`;
    }
    const [stock, purchases, production] = await Promise.all([
      this.dataSource.query<{ productId: string; quantity: string }[]>(
        `SELECT "productId", SUM(GREATEST("quantity", 0)) AS "quantity" FROM stock_levels
          WHERE "tenantId" = $1 AND "productId" = ANY($2::uuid[]) ${filter}
          GROUP BY "productId"`,
        params,
      ),
      this.dataSource.query<{ productId: string; quantity: string }[]>(
        `SELECT l."productId", SUM(l."baseQuantity") AS "quantity"
           FROM purchase_invoice_lines l
           JOIN purchase_invoices i ON i."id" = l."invoiceId"
          WHERE i."tenantId" = $1 AND i."status" = 'draft' AND i."deletedAt" IS NULL
            AND l."productId" = ANY($2::uuid[]) ${filter.replace('"warehouseId"', 'i."warehouseId"')}
          GROUP BY l."productId"`,
        params,
      ),
      this.dataSource.query<{ productId: string; quantity: string }[]>(
        `SELECT "productId", SUM(GREATEST("plannedQuantity" - "producedQuantity", 0)) AS "quantity"
           FROM production_orders
          WHERE "tenantId" = $1 AND "status" IN ('draft','released','in_progress')
            AND "deletedAt" IS NULL AND "productId" = ANY($2::uuid[]) ${filter}
          GROUP BY "productId"`,
        params,
      ),
    ]);
    const onHand = new Map(
      stock.map((r) => [r.productId, new Decimal(r.quantity)]),
    );
    const incoming = new Map<string, Decimal>();
    for (const row of [...purchases, ...production]) {
      incoming.set(
        row.productId,
        (incoming.get(row.productId) ?? new Decimal(0)).plus(row.quantity),
      );
    }
    return { onHand, incoming };
  }

  /** آخر مورد اشتُري منه كل صنف (من فاتورة معتمدة) ومدة توريده */
  private async lastSuppliers(
    tenantId: string,
    productIds: string[],
  ): Promise<
    Map<
      string,
      {
        supplierId: string;
        supplierName: string;
        leadTimeDays: number | null;
        lastCost: string;
      }
    >
  > {
    const rows = await this.dataSource.query<
      {
        productId: string;
        supplierId: string;
        supplierName: string;
        leadTimeDays: number | null;
        lastCost: string;
      }[]
    >(
      `SELECT DISTINCT ON (l."productId") l."productId", s."id" AS "supplierId",
              s."name" AS "supplierName", s."leadTimeDays", l."unitCost" AS "lastCost"
         FROM purchase_invoice_lines l
         JOIN purchase_invoices i ON i."id" = l."invoiceId" AND i."status" = 'posted'
         JOIN suppliers s ON s."id" = i."supplierId"
        WHERE i."tenantId" = $1 AND l."productId" = ANY($2::uuid[])
        ORDER BY l."productId", i."invoiceDate" DESC, i."createdAt" DESC`,
      [tenantId, productIds],
    );
    return new Map(rows.map((r) => [r.productId, r]));
  }
}

function dateRange(from: string, to: string): string[] {
  const days: string[] = [];
  const end = new Date(`${to}T00:00:00Z`);
  for (
    let day = new Date(`${from}T00:00:00Z`);
    day <= end && days.length <= MAX_RANGE_DAYS + 1;
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

const round4 = (v: Decimal) => v.toDecimalPlaces(4).toNumber();
const round2 = (v: Decimal) => v.toDecimalPlaces(2).toNumber();
const pct = (ratio: number) => Number((ratio * 100).toFixed(2));
