// src/modules/pos/restaurant-reports.service.ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  dayOffsetInZone,
  tenantTimezoneOf,
} from '../../common/utils/timezone.util';
import { assertBranchAllowed, scopedBranchIds } from '../branches/branch-scope';
import { RestaurantReportQueryDto } from './dto/restaurant-menu.dto';
import { KitchenOrder } from './entities/restaurant.entity';

export type MenuClass = 'star' | 'plowhorse' | 'puzzle' | 'dog';

/**
 * تقارير المطعم — كل ما فيها من بيانات تُسجَّل لحظة حدوثها:
 *  - هندسة المنيو: لكل صنف شعبيته وهامشه بتكلفة وصفته الفعلية وقت البيع،
 *    وتصنيفه (نجم، حصان عمل، لغز، خاسر) بطريقة Kasavana & Smith.
 *  - الاستهلاك النظري مقابل الفعلي: ما استهلكته الوصفات مقابل ما خرج فعلاً
 *    (هالك وتسويات وفروق جرد) لكل مكوّن، بقيمته.
 *  - الخدمة: الضيوف، متوسط الفاتورة والضيف، مدة جلوس الطاولة، الطلب بالساعة،
 *    أزمنة المطبخ لكل محطة، والحجوزات وعدم الحضور.
 */
@Injectable()
export class RestaurantReportsService {
  constructor(private readonly dataSource: DataSource) {}

  async menuEngineering(tenantId: string, query: RestaurantReportQueryDto) {
    const { params, filter } = this.scope(tenantId, query, 'i');
    const rows = await this.dataSource.query<
      {
        productId: string;
        name: string;
        categoryName: string | null;
        type: string;
        quantity: string;
        revenue: string;
        cost: string;
      }[]
    >(
      `SELECT l."productId", p."name", c."name" AS "categoryName", p."type",
              SUM(l."baseQuantity" * (1 - l."returnedQuantity" / NULLIF(l."quantity", 0))) AS "quantity",
              SUM(l."subtotal" * (1 - l."returnedQuantity" / NULLIF(l."quantity", 0))) AS "revenue",
              SUM(l."unitCost" * l."baseQuantity" * (1 - l."returnedQuantity" / NULLIF(l."quantity", 0))) AS "cost"
         FROM sales_invoice_lines l
         JOIN sales_invoices i ON i."id" = l."invoiceId"
         JOIN products p ON p."id" = l."productId"
         LEFT JOIN product_categories c ON c."id" = p."categoryId"
        WHERE i."tenantId" = $1 AND i."status" = 'issued' AND p."type" <> 'service'
          AND i."invoiceDate" BETWEEN $2::date AND $3::date ${filter}
        GROUP BY l."productId", p."name", c."name", p."type"
       HAVING SUM(l."baseQuantity") > 0`,
      params,
    );
    const items = rows
      .map((r) => {
        const quantity = Number(r.quantity) || 0;
        const revenue = Number(r.revenue) || 0;
        const cost = Number(r.cost) || 0;
        return {
          productId: r.productId,
          name: r.name,
          categoryName: r.categoryName,
          isComposite: r.type === 'composite',
          quantity: round(quantity, 4),
          revenue: round(revenue),
          cost: round(cost),
          margin: round(revenue - cost),
          unitMargin: quantity ? round((revenue - cost) / quantity, 4) : 0,
          costPercent: revenue ? round((cost / revenue) * 100, 2) : 0,
        };
      })
      .filter((i) => i.quantity > 0);
    const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);
    const totalMargin = items.reduce((s, i) => s + i.margin, 0);
    // عتبة الشعبية: 70% من النصيب المتساوي، والهامش المرجعي متوسطه المرجّح
    const popularityThreshold = items.length
      ? (0.7 * totalQuantity) / items.length
      : 0;
    const averageMargin = totalQuantity ? totalMargin / totalQuantity : 0;
    return {
      popularityThreshold: round(popularityThreshold, 4),
      averageUnitMargin: round(averageMargin, 4),
      totalRevenue: round(items.reduce((s, i) => s + i.revenue, 0)),
      totalCost: round(items.reduce((s, i) => s + i.cost, 0)),
      items: items
        .map((item) => {
          const popular = item.quantity >= popularityThreshold;
          const profitable = item.unitMargin >= averageMargin;
          const menuClass: MenuClass = popular
            ? profitable
              ? 'star'
              : 'plowhorse'
            : profitable
              ? 'puzzle'
              : 'dog';
          return {
            ...item,
            mix: totalQuantity
              ? round((item.quantity / totalQuantity) * 100, 2)
              : 0,
            class: menuClass,
          };
        })
        .sort((a, b) => b.margin - a.margin),
    };
  }

  async consumption(tenantId: string, query: RestaurantReportQueryDto) {
    const { start, end } = await this.bounds(tenantId, query);
    const params: unknown[] = [tenantId, start, end];
    let filter = '';
    const warehouses = await this.scopedWarehouses(tenantId, query.branchId);
    if (warehouses) {
      params.push(warehouses);
      filter = ` AND m."warehouseId" = ANY($4::uuid[])`;
    }
    const rows = await this.dataSource.query<Record<string, string | null>[]>(
      `SELECT m."productId", p."name", p."sku", u."name" AS "unit",
              COALESCE(SUM(-m."quantity") FILTER (WHERE m."type" = 'consumption'), 0) AS "recipe",
              COALESCE(SUM(-m."quantity") FILTER (WHERE m."type" = 'sale'), 0) AS "direct",
              COALESCE(SUM(-m."quantity") FILTER (WHERE m."type" = 'adjustment' AND m."reason" = 'waste'), 0) AS "waste",
              COALESCE(SUM(-m."quantity") FILTER (WHERE m."type" = 'adjustment' AND m."reason" IN ('damage','expiry')), 0) AS "spoilage",
              COALESCE(SUM(-m."quantity") FILTER (WHERE m."type" = 'adjustment'
                         AND COALESCE(m."reason", 'other') NOT IN ('waste','damage','expiry')), 0) AS "otherAdjustments",
              COALESCE(SUM(-m."quantity") FILTER (WHERE m."type" = 'stocktake'), 0) AS "stocktake",
              COALESCE(MAX(it."avgCost"), 0) AS "avgCost"
         FROM stock_movements m
         JOIN products p ON p."id" = m."productId"
         LEFT JOIN units u ON u."id" = p."baseUnitId"
         LEFT JOIN inventory_items it ON it."tenantId" = m."tenantId" AND it."productId" = m."productId"
        WHERE m."tenantId" = $1 AND m."occurredAt" >= $2 AND m."occurredAt" < $3 ${filter}
          AND EXISTS (SELECT 1 FROM bom_lines bl JOIN boms b ON b."id" = bl."bomId"
                       WHERE bl."componentId" = m."productId" AND b."kind" = 'recipe'
                         AND b."deletedAt" IS NULL)
        GROUP BY m."productId", p."name", p."sku", u."name"
        ORDER BY p."name"`,
      params,
    );
    return rows.map((r) => {
      const recipe = Number(r.recipe);
      const direct = Number(r.direct);
      const theoretical = recipe + direct;
      const losses =
        Number(r.waste) +
        Number(r.spoilage) +
        Number(r.otherAdjustments) +
        Number(r.stocktake);
      const actual = theoretical + losses;
      const avgCost = Number(r.avgCost);
      return {
        productId: r.productId,
        name: r.name,
        sku: r.sku,
        unit: r.unit,
        recipeUsage: round(recipe, 4),
        directSales: round(direct, 4),
        theoretical: round(theoretical, 4),
        waste: round(Number(r.waste), 4),
        spoilage: round(Number(r.spoilage), 4),
        otherAdjustments: round(Number(r.otherAdjustments), 4),
        stocktakeDifference: round(Number(r.stocktake), 4),
        actual: round(actual, 4),
        variance: round(losses, 4),
        variancePercent: theoretical
          ? round((losses / theoretical) * 100, 2)
          : null,
        varianceValue: round(losses * avgCost),
      };
    });
  }

  async service(tenantId: string, query: RestaurantReportQueryDto) {
    const timezone = await tenantTimezoneOf(this.dataSource.manager, tenantId);
    const { start, end } = await this.bounds(tenantId, query);
    const { params, filter } = this.scope(tenantId, query, 'i');
    const [orders] = await this.dataSource.query<
      Record<string, string | null>[]
    >(
      `SELECT COUNT(*) AS "orders",
              COALESCE(SUM(i."total" - i."returnedAmount"), 0) AS "revenue",
              COALESCE(SUM(i."guestCount"), 0) AS "covers",
              COUNT(*) FILTER (WHERE i."orderType" = 'dine_in') AS "dineIn",
              COUNT(*) FILTER (WHERE i."orderType" = 'takeaway') AS "takeaway",
              COUNT(*) FILTER (WHERE i."orderType" = 'delivery' OR i."isDelivery") AS "delivery",
              COALESCE(SUM(i."total") FILTER (WHERE i."guestCount" > 0), 0) AS "coveredRevenue",
              AVG(EXTRACT(EPOCH FROM (i."issuedAt" - i."orderOpenedAt")) / 60)
                FILTER (WHERE i."orderType" = 'dine_in' AND i."orderOpenedAt" IS NOT NULL
                          AND i."issuedAt" > i."orderOpenedAt") AS "tableMinutes"
         FROM sales_invoices i
        WHERE i."tenantId" = $1 AND i."status" = 'issued'
          AND i."invoiceDate" BETWEEN $2::date AND $3::date ${filter}`,
      params,
    );
    const byHour = await this.dataSource.query<
      { hour: string; orders: string; revenue: string }[]
    >(
      `SELECT EXTRACT(HOUR FROM i."issuedAt" AT TIME ZONE '${timezone.replace(/'/g, '')}') AS "hour",
              COUNT(*) AS "orders", SUM(i."total") AS "revenue"
         FROM sales_invoices i
        WHERE i."tenantId" = $1 AND i."status" = 'issued'
          AND i."invoiceDate" BETWEEN $2::date AND $3::date ${filter}
        GROUP BY 1 ORDER BY 1`,
      params,
    );

    // المطبخ: الانتظار حتى البدء، والتحضير حتى الجاهزية — للبون ولكل محطة
    const kitchenParams: unknown[] = [tenantId, start, end];
    let kitchenFilter = '';
    const branches = query.branchId ? [query.branchId] : scopedBranchIds();
    if (branches) {
      kitchenParams.push(branches);
      kitchenFilter = ` AND "branchId" = ANY($4::uuid[])`;
    }
    const tickets = await this.dataSource.query<
      Pick<KitchenOrder, 'sentAt' | 'startedAt' | 'readyAt' | 'stations'>[]
    >(
      `SELECT "sentAt", "startedAt", "readyAt", "stations" FROM kitchen_orders
        WHERE "tenantId" = $1 AND "sentAt" >= $2 AND "sentAt" < $3
          AND "status" <> 'cancelled' ${kitchenFilter}
        LIMIT 20000`,
      kitchenParams,
    );
    const stationNames = new Map(
      (
        await this.dataSource.query<{ id: string; name: string }[]>(
          `SELECT "id", "name" FROM kitchen_stations WHERE "tenantId" = $1`,
          [tenantId],
        )
      ).map((s) => [s.id, s.name]),
    );
    const minutes = (from?: Date | string | null, to?: Date | string | null) =>
      from && to
        ? (new Date(to).getTime() - new Date(from).getTime()) / 60_000
        : null;
    const kitchen = averages(
      tickets.map((t) => ({
        wait: minutes(t.sentAt, t.startedAt),
        prep: minutes(t.startedAt, t.readyAt),
        total: minutes(t.sentAt, t.readyAt),
      })),
    );
    const perStation = new Map<
      string,
      { prep: number | null; total: number | null }[]
    >();
    for (const ticket of tickets) {
      for (const [stationId, progress] of Object.entries(
        ticket.stations ?? {},
      )) {
        if (!perStation.has(stationId)) perStation.set(stationId, []);
        perStation.get(stationId)!.push({
          prep: minutes(progress.startedAt, progress.readyAt),
          total: minutes(ticket.sentAt, progress.readyAt),
        });
      }
    }

    const [reservations] = await this.dataSource.query<
      Record<string, string>[]
    >(
      `SELECT COUNT(*) AS "total",
              COUNT(*) FILTER (WHERE "status" = 'no_show') AS "noShow",
              COUNT(*) FILTER (WHERE "status" = 'cancelled') AS "cancelled",
              COUNT(*) FILTER (WHERE "status" IN ('seated','completed')) AS "honored",
              COALESCE(SUM("guestCount") FILTER (WHERE "status" IN ('seated','completed')), 0) AS "guests"
         FROM reservations
        WHERE "tenantId" = $1 AND "deletedAt" IS NULL
          AND "reservedAt" >= $2 AND "reservedAt" < $3`,
      [tenantId, start, end],
    );

    const count = Number(orders.orders);
    const covers = Number(orders.covers);
    return {
      orders: count,
      revenue: round(Number(orders.revenue)),
      averageCheck: count ? round(Number(orders.revenue) / count) : 0,
      covers,
      revenuePerCover: covers
        ? round(Number(orders.coveredRevenue) / covers)
        : null,
      byType: {
        dineIn: Number(orders.dineIn),
        takeaway: Number(orders.takeaway),
        delivery: Number(orders.delivery),
      },
      averageTableMinutes: orders.tableMinutes
        ? round(Number(orders.tableMinutes), 1)
        : null,
      byHour: byHour.map((h) => ({
        hour: Number(h.hour),
        orders: Number(h.orders),
        revenue: round(Number(h.revenue)),
      })),
      kitchen: { tickets: tickets.length, ...kitchen },
      stations: [...perStation.entries()].map(([stationId, rows]) => ({
        stationId,
        name:
          stationNames.get(stationId) ??
          (stationId === 'general' ? 'المطبخ العام' : stationId),
        tickets: rows.length,
        ...averages(rows),
      })),
      reservations: {
        total: Number(reservations.total),
        honored: Number(reservations.honored),
        cancelled: Number(reservations.cancelled),
        noShow: Number(reservations.noShow),
        noShowRate: Number(reservations.total)
          ? round(
              (Number(reservations.noShow) / Number(reservations.total)) * 100,
              2,
            )
          : 0,
        guests: Number(reservations.guests),
      },
    };
  }

  // ══════════════════════════ داخلي ══════════════════════════

  /** الفترة بتوقيت الشركة كلحظتين UTC */
  private async bounds(tenantId: string, query: RestaurantReportQueryDto) {
    const timezone = await tenantTimezoneOf(this.dataSource.manager, tenantId);
    return {
      start: dayOffsetInZone(query.from, 0, timezone),
      end: dayOffsetInZone(query.to, 24 * 60, timezone),
    };
  }

  /** شرط الفرع على فواتير البيع (بمخزنها) */
  private scope(
    tenantId: string,
    query: RestaurantReportQueryDto,
    alias: string,
  ) {
    const params: unknown[] = [tenantId, query.from, query.to];
    let filter = '';
    const branches = query.branchId ? [query.branchId] : scopedBranchIds();
    if (query.branchId) assertBranchAllowed(query.branchId);
    if (branches) {
      params.push(branches);
      filter = ` AND ${alias}."warehouseId" IN (SELECT "id" FROM warehouses WHERE "branchId" = ANY($4::uuid[]))`;
    }
    return { params, filter };
  }

  private async scopedWarehouses(
    tenantId: string,
    branchId?: string,
  ): Promise<string[] | null> {
    const branches = branchId ? [branchId] : scopedBranchIds();
    if (branchId) assertBranchAllowed(branchId);
    if (!branches) return null;
    const rows = await this.dataSource.query<{ id: string }[]>(
      `SELECT "id" FROM warehouses WHERE "tenantId" = $1 AND "branchId" = ANY($2::uuid[])`,
      [tenantId, branches],
    );
    return rows.map((r) => r.id);
  }
}

function averages(
  rows: Record<string, number | null>[],
): Record<string, number | null> {
  const keys = rows.length ? Object.keys(rows[0]) : ['wait', 'prep', 'total'];
  const result: Record<string, number | null> = {};
  for (const key of keys) {
    const values = rows
      .map((r) => r[key])
      .filter((v): v is number => v !== null && v >= 0);
    result[`avg${key[0].toUpperCase()}${key.slice(1)}Minutes`] = values.length
      ? round(values.reduce((s, v) => s + v, 0) / values.length, 1)
      : null;
  }
  return result;
}

function round(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
