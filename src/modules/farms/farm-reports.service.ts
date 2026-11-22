// src/modules/farms/farm-reports.service.ts
//
// تقارير المزارع — كلها من بيانات سُجّلت لحظة حدوثها (لا من معاملات مقدّرة):
//   اللوحة     ما يحتاج انتباهاً الآن وأرقام السنة
//   الإنتاجية  الحصاد مقابل المتوقع: للزراعة، الصنف، الوحدة، أو النخلة
//   التكلفة    مدخلات + عمالة + مياه مقابل الحصاد: تكلفة الكيلو وهامشه
//   الآفات     الإصابة بالآفة والشهر والوحدة
//   السجل      النخيل بأصنافها وحالاتها وأعمارها وما أُزيل ولماذا
//   المياه     الاستهلاك بالوحدة والمصدر والشهر ولكل هكتار
import { Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { DataSource } from 'typeorm';
import {
  dayKeyInZone,
  tenantTimezoneOf,
} from '../../common/utils/timezone.util';
import { FarmReportQueryDto } from './dto/farm-work.dto';
import { PlantingTrackingMode } from './entities/farm-enums';
import { addDays } from './farm-utils';
import { FarmsService } from './farms.service';
import { PlantingsService } from './plantings.service';

interface Scope {
  farmIds: string[];
  zone: string;
  today: string;
  from: string;
  to: string;
  unitPath: string | null;
}

const num = (value: unknown) => Number(value ?? 0);
const round = (value: Decimal.Value, places = 3) =>
  new Decimal(value).toDecimalPlaces(places).toNumber();
const ratio = (part: number, whole: number, places = 3) =>
  whole ? round(new Decimal(part).div(whole), places) : null;

@Injectable()
export class FarmReportsService {
  constructor(
    private readonly farms: FarmsService,
    private readonly plantings: PlantingsService,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════ اللوحة ══════════════════════════

  async dashboard(query: FarmReportQueryDto, tenantId: string) {
    const s = await this.scope(query, tenantId, { defaultFrom: 'year' });
    const ids = s.farmIds;
    const q = <T>(sql: string, params: unknown[] = []) =>
      this.dataSource.query<T[]>(sql, [ids, ...params]);

    const [
      farm,
      plantings,
      plants,
      overdue,
      upcoming,
      ops,
      harvest,
      inspections,
      pests,
      water,
    ] = await Promise.all([
      q<{ farms: string; area: string; units: string }>(
        `SELECT COUNT(*) AS "farms", COALESCE(SUM("areaM2"), 0) AS "area",
                  (SELECT COUNT(*) FROM farm_units u WHERE u."farmId" = ANY($1::uuid[]) AND u."deletedAt" IS NULL) AS "units"
             FROM farms WHERE id = ANY($1::uuid[])`,
      ),
      q<{ category: string; plantings: string; plants: string; area: string }>(
        `SELECT c.category, COUNT(*) AS "plantings", COALESCE(SUM(p."plantCount"), 0) AS "plants",
                  COALESCE(SUM(p."areaM2"), 0) AS "area"
             FROM plantings p JOIN crops c ON c.id = p."cropId"
            WHERE p."farmId" = ANY($1::uuid[]) AND p."deletedAt" IS NULL AND p.status = 'active'
            GROUP BY c.category ORDER BY 2 DESC`,
      ),
      q<{ status: string; count: string }>(
        `SELECT status, COUNT(*) AS "count" FROM farm_plants
            WHERE "farmId" = ANY($1::uuid[]) AND "deletedAt" IS NULL GROUP BY status`,
      ),
      q<{ count: string }>(
        `SELECT COUNT(*) AS "count" FROM farm_operations
            WHERE "farmId" = ANY($1::uuid[]) AND "deletedAt" IS NULL
              AND status = 'planned' AND "plannedDate" < $2`,
        [s.today],
      ),
      q<{ count: string }>(
        `SELECT COUNT(*) AS "count" FROM farm_operations
            WHERE "farmId" = ANY($1::uuid[]) AND "deletedAt" IS NULL
              AND status = 'planned' AND "plannedDate" BETWEEN $2 AND $3`,
        [s.today, addDays(s.today, 7)],
      ),
      q<{
        type: string;
        count: string;
        inputCost: string;
        laborCost: string;
        hours: string;
        water: string;
      }>(
        `SELECT type, COUNT(*) AS "count", COALESCE(SUM("inputCost"), 0) AS "inputCost",
                  COALESCE(SUM("laborCost"), 0) AS "laborCost", COALESCE(SUM("laborHours"), 0) AS "hours",
                  COALESCE(SUM("waterM3"), 0) AS "water"
             FROM farm_operations
            WHERE "farmId" = ANY($1::uuid[]) AND "deletedAt" IS NULL AND status = 'done'
              AND ("performedAt" AT TIME ZONE $2)::date BETWEEN $3 AND $4
            GROUP BY type ORDER BY 2 DESC`,
        [s.zone, s.from, s.to],
      ),
      q<{
        productId: string;
        productName: string;
        unitName: string | null;
        quantity: string;
        reject: string;
        value: string;
        count: string;
      }>(
        `SELECT h."productId", pr.name AS "productName", u.name AS "unitName",
                  SUM(h.quantity) AS "quantity", COALESCE(SUM(h."rejectQuantity"), 0) AS "reject",
                  SUM(h.value) AS "value", COUNT(*) AS "count"
             FROM farm_harvests h
             JOIN products pr ON pr.id = h."productId"
             LEFT JOIN units u ON u.id = pr."baseUnitId"
            WHERE h."farmId" = ANY($1::uuid[]) AND h."deletedAt" IS NULL AND h.status = 'recorded'
              AND (h."harvestedAt" AT TIME ZONE $2)::date BETWEEN $3 AND $4
            GROUP BY h."productId", pr.name, u.name ORDER BY 4 DESC`,
        [s.zone, s.from, s.to],
      ),
      q<{ severity: number; count: string }>(
        `SELECT severity, COUNT(*) AS "count" FROM farm_inspections
            WHERE "farmId" = ANY($1::uuid[]) AND "deletedAt" IS NULL AND status <> 'resolved'
            GROUP BY severity ORDER BY severity DESC`,
      ),
      q<{ pest: string; pestName: string | null; count: string }>(
        `SELECT pest, MAX("pestName") AS "pestName", COUNT(*) AS "count" FROM farm_inspections
            WHERE "farmId" = ANY($1::uuid[]) AND "deletedAt" IS NULL AND status <> 'resolved'
            GROUP BY pest ORDER BY 3 DESC LIMIT 5`,
      ),
      q<{ water: string }>(
        `SELECT COALESCE(SUM("waterM3"), 0) AS "water" FROM farm_operations
            WHERE "farmId" = ANY($1::uuid[]) AND "deletedAt" IS NULL AND status = 'done'
              AND ("performedAt" AT TIME ZONE $2)::date > $3`,
        [s.zone, addDays(s.today, -30)],
      ),
    ]);

    const plantStatus = Object.fromEntries(
      plants.map((p) => [p.status, num(p.count)]),
    );
    const costs = ops.reduce(
      (sum, o) => ({
        inputs: sum.inputs.plus(o.inputCost),
        labor: sum.labor.plus(o.laborCost),
      }),
      { inputs: new Decimal(0), labor: new Decimal(0) },
    );
    return {
      period: { from: s.from, to: s.to },
      farms: num(farm[0]?.farms),
      areaM2: num(farm[0]?.area),
      units: num(farm[0]?.units),
      plantings: plantings.map((p) => ({
        category: p.category,
        plantings: num(p.plantings),
        plants: num(p.plants),
        areaM2: num(p.area),
      })),
      plants: {
        byStatus: plantStatus,
        live: Object.entries(plantStatus)
          .filter(([status]) => !['dead', 'removed'].includes(status))
          .reduce((sum, [, count]) => sum + count, 0),
      },
      operations: {
        overdue: num(overdue[0]?.count),
        upcoming: num(upcoming[0]?.count),
        byType: ops.map((o) => ({
          type: o.type,
          count: num(o.count),
          inputCost: num(o.inputCost),
          laborCost: num(o.laborCost),
          laborHours: num(o.hours),
          waterM3: num(o.water),
        })),
      },
      harvest: harvest.map((h) => ({
        productId: h.productId,
        productName: h.productName,
        unitName: h.unitName,
        quantity: num(h.quantity),
        rejectQuantity: num(h.reject),
        value: num(h.value),
        count: num(h.count),
      })),
      costs: {
        inputs: round(costs.inputs),
        labor: round(costs.labor),
        total: round(costs.inputs.plus(costs.labor)),
      },
      inspections: {
        open: inspections.reduce((sum, i) => sum + num(i.count), 0),
        bySeverity: inspections.map((i) => ({
          severity: num(i.severity),
          count: num(i.count),
        })),
        topPests: pests.map((p) => ({
          pest: p.pest,
          pestName: p.pestName,
          count: num(p.count),
        })),
      },
      waterM3Last30Days: num(water[0]?.water),
    };
  }

  // ══════════════════════════ الإنتاجية ══════════════════════════

  /**
   * الحصاد في الفترة مقابل المتوقع. للزراعة: لكل نبتة ولكل هكتار ونسبة
   * المتوقع (المكتوب أو من الصنف). للنخلة: الأعلى والأقل إنتاجاً بين القائمة.
   */
  async yields(query: FarmReportQueryDto, tenantId: string) {
    const s = await this.scope(query, tenantId, { defaultFrom: 'year' });
    const groupBy = query.groupBy ?? 'planting';
    const params: unknown[] = [
      s.farmIds,
      s.zone,
      s.from,
      s.to,
      s.unitPath,
      query.cropId ?? null,
    ];
    const where = `h."farmId" = ANY($1::uuid[]) AND h."deletedAt" IS NULL AND h.status = 'recorded'
        AND (h."harvestedAt" AT TIME ZONE $2)::date BETWEEN $3 AND $4
        AND ($5::text IS NULL OR hu.path = $5 OR hu.path LIKE $5 || '/%')
        AND ($6::uuid IS NULL OR p."cropId" = $6)`;
    const from = `farm_harvests h
        LEFT JOIN farm_units hu ON hu.id = h."unitId"
        LEFT JOIN plantings p ON p.id = h."plantingId"`;

    if (groupBy === 'plant') {
      const rows = await this.dataSource.query<
        {
          plantId: string;
          tag: string;
          unitName: string;
          varietyName: string | null;
          quantity: string;
          harvests: string;
        }[]
      >(
        `SELECT pl.id AS "plantId", pl.tag, u.name AS "unitName", v.name AS "varietyName",
                SUM(h.quantity) AS "quantity", COUNT(*) AS "harvests"
           FROM ${from}
           JOIN farm_plants pl ON pl.id = h."plantId"
           JOIN farm_units u ON u.id = pl."unitId"
           LEFT JOIN crop_varieties v ON v.id = p."varietyId"
          WHERE ${where}
          GROUP BY pl.id, pl.tag, u.name, v.name ORDER BY 5 DESC`,
        params,
      );
      const list = rows.map((r) => ({
        plantId: r.plantId,
        tag: r.tag,
        unitName: r.unitName,
        varietyName: r.varietyName,
        quantity: num(r.quantity),
        harvests: num(r.harvests),
      }));
      const quantities = list.map((r) => r.quantity);
      const total = quantities.reduce((a, b) => a + b, 0);
      return {
        period: { from: s.from, to: s.to },
        groupBy,
        plants: list.length,
        average: list.length ? round(total / list.length) : null,
        top: list.slice(0, 50),
        bottom: [...list].reverse().slice(0, 50),
      };
    }

    const key = {
      planting: 'p.id',
      variety: `COALESCE(p."varietyId"::text, p."cropId"::text)`,
      unit: 'h."unitId"',
      type: 'h."productId"',
      month: `to_char(h."harvestedAt" AT TIME ZONE $2, 'YYYY-MM')`,
    }[groupBy];
    const rows = await this.dataSource.query<
      {
        key: string | null;
        quantity: string;
        reject: string;
        gross: string;
        value: string;
        harvests: string;
        containers: string;
      }[]
    >(
      `SELECT ${key} AS "key", SUM(h.quantity) AS "quantity",
              COALESCE(SUM(h."rejectQuantity"), 0) AS "reject",
              COALESCE(SUM(h."grossQuantity"), 0) AS "gross",
              SUM(h.value) AS "value", COUNT(*) AS "harvests",
              COALESCE(SUM(h.containers), 0) AS "containers"
         FROM ${from}
        WHERE ${where}
        GROUP BY 1 ORDER BY 2 DESC`,
      params,
    );
    const base = rows.map((r) => ({
      key: r.key,
      quantity: num(r.quantity),
      rejectQuantity: num(r.reject),
      grossQuantity: num(r.gross),
      value: num(r.value),
      harvests: num(r.harvests),
      containers: num(r.containers),
      rejectRate: ratio(num(r.reject), num(r.quantity) + num(r.reject), 4),
    }));

    if (groupBy !== 'planting') {
      const labels = await this.labels(
        groupBy,
        base.map((r) => r.key).filter((k): k is string => !!k),
      );
      return {
        period: { from: s.from, to: s.to },
        groupBy,
        rows: base.map((r) => ({
          ...r,
          label: (r.key && labels.get(r.key)) || '—',
        })),
      };
    }

    // للزراعة: المتوقع والإنتاجية لكل نبتة ولكل هكتار
    const plantingIds = base.map((r) => r.key).filter((k): k is string => !!k);
    const details = plantingIds.length
      ? await this.dataSource.query<
          {
            id: string;
            number: string;
            unitName: string;
            cropName: string;
            lifecycle: string;
            varietyName: string | null;
            trackingMode: PlantingTrackingMode;
            plantCount: number;
            areaM2: string | null;
            expectedYield: string | null;
            perPlant: string | null;
            perHectare: string | null;
            season: string | null;
            status: string;
          }[]
        >(
          `SELECT p.id, p.number, u.name AS "unitName", c.name AS "cropName", c.lifecycle,
                  v.name AS "varietyName", p."trackingMode", p."plantCount", p."areaM2",
                  p."expectedYield", v."expectedYieldPerPlant" AS "perPlant",
                  v."expectedYieldPerHectare" AS "perHectare", p.season, p.status
             FROM plantings p
             JOIN farm_units u ON u.id = p."unitId"
             JOIN crops c ON c.id = p."cropId"
             LEFT JOIN crop_varieties v ON v.id = p."varietyId"
            WHERE p.id = ANY($1::uuid[])`,
          [plantingIds],
        )
      : [];
    const byId = new Map(details.map((d) => [d.id, d]));
    return {
      period: { from: s.from, to: s.to },
      groupBy,
      rows: base.map((r) => {
        const d = r.key ? byId.get(r.key) : undefined;
        if (!d) return { ...r, label: 'بلا زراعة' };
        const expected = this.plantings.expectedYieldOf({
          expectedYield: d.expectedYield === null ? null : num(d.expectedYield),
          crop: { lifecycle: d.lifecycle as never },
          variety: {
            expectedYieldPerPlant: d.perPlant === null ? null : num(d.perPlant),
            expectedYieldPerHectare:
              d.perHectare === null ? null : num(d.perHectare),
          },
          plantCount: d.plantCount,
          areaM2: d.areaM2 === null ? null : num(d.areaM2),
          trackingMode: d.trackingMode,
        });
        const hectares = d.areaM2 ? num(d.areaM2) / 10000 : 0;
        return {
          ...r,
          label: `${d.cropName}${d.varietyName ? ` — ${d.varietyName}` : ''} (${d.unitName})`,
          number: d.number,
          season: d.season,
          status: d.status,
          plantCount: d.plantCount,
          areaM2: d.areaM2 === null ? null : num(d.areaM2),
          perPlant: ratio(r.quantity, d.plantCount),
          perHectare: hectares ? round(r.quantity / hectares) : null,
          expected,
          achievement: expected
            ? round((r.quantity / expected) * 100, 1)
            : null,
        };
      }),
    };
  }

  // ══════════════════════════ التكلفة ══════════════════════════

  /**
   * التكلفة مقابل الحصاد. عملية على زراعة تُحمَّل عليها؛ عملية على وحدة أو
   * المزرعة تُوزَّع على زراعاتها القائمة بعدد النبات (أو المساحة).
   */
  async costs(query: FarmReportQueryDto, tenantId: string) {
    const s = await this.scope(query, tenantId, { defaultFrom: 'year' });
    const groupBy =
      query.groupBy === 'type' || query.groupBy === 'month'
        ? query.groupBy
        : 'planting';
    const opParams: unknown[] = [s.farmIds, s.zone, s.from, s.to, s.unitPath];
    const opWhere = `o."farmId" = ANY($1::uuid[]) AND o."deletedAt" IS NULL AND o.status = 'done'
        AND (o."performedAt" AT TIME ZONE $2)::date BETWEEN $3 AND $4
        AND ($5::text IS NULL OR u.path = $5 OR u.path LIKE $5 || '/%')`;

    if (groupBy !== 'planting') {
      const key =
        groupBy === 'type'
          ? 'o.type'
          : `to_char(o."performedAt" AT TIME ZONE $2, 'YYYY-MM')`;
      const [rows, harvest] = await Promise.all([
        this.dataSource.query<
          {
            key: string;
            count: string;
            inputs: string;
            labor: string;
            hours: string;
            water: string;
          }[]
        >(
          `SELECT ${key} AS "key", COUNT(*) AS "count", SUM(o."inputCost") AS "inputs",
                  SUM(o."laborCost") AS "labor", COALESCE(SUM(o."laborHours"), 0) AS "hours",
                  COALESCE(SUM(o."waterM3"), 0) AS "water"
             FROM farm_operations o LEFT JOIN farm_units u ON u.id = o."unitId"
            WHERE ${opWhere} GROUP BY 1 ORDER BY 1`,
          opParams,
        ),
        groupBy === 'month'
          ? this.dataSource.query<
              { key: string; quantity: string; value: string; labor: string }[]
            >(
              `SELECT to_char(h."harvestedAt" AT TIME ZONE $2, 'YYYY-MM') AS "key",
                      SUM(h.quantity) AS "quantity", SUM(h.value) AS "value", SUM(h."laborCost") AS "labor"
                 FROM farm_harvests h LEFT JOIN farm_units u ON u.id = h."unitId"
                WHERE h."farmId" = ANY($1::uuid[]) AND h."deletedAt" IS NULL AND h.status = 'recorded'
                  AND (h."harvestedAt" AT TIME ZONE $2)::date BETWEEN $3 AND $4
                  AND ($5::text IS NULL OR u.path = $5 OR u.path LIKE $5 || '/%')
                GROUP BY 1`,
              opParams,
            )
          : Promise.resolve([]),
      ]);
      const harvestBy = new Map(harvest.map((h) => [h.key, h]));
      const keys = [
        ...new Set([...rows.map((r) => r.key), ...harvest.map((h) => h.key)]),
      ].sort();
      return {
        period: { from: s.from, to: s.to },
        groupBy,
        rows: keys.map((k) => {
          const r = rows.find((x) => x.key === k);
          const h = harvestBy.get(k);
          const labor = num(r?.labor) + num(h?.labor);
          return {
            key: k,
            operations: num(r?.count),
            inputCost: num(r?.inputs),
            laborCost: round(labor),
            laborHours: num(r?.hours),
            waterM3: num(r?.water),
            totalCost: round(num(r?.inputs) + labor),
            harvestQuantity: num(h?.quantity),
            harvestValue: num(h?.value),
          };
        }),
      };
    }

    // ─── لكل زراعة، بالتوزيع ───
    const [ops, plantings, harvests] = await Promise.all([
      this.dataSource.query<
        {
          plantingId: string | null;
          unitPath: string | null;
          farmId: string;
          inputs: string;
          labor: string;
          hours: string;
          water: string;
          count: string;
        }[]
      >(
        `SELECT o."plantingId", u.path AS "unitPath", o."farmId",
                SUM(o."inputCost") AS "inputs", SUM(o."laborCost") AS "labor",
                COALESCE(SUM(o."laborHours"), 0) AS "hours", COALESCE(SUM(o."waterM3"), 0) AS "water",
                COUNT(*) AS "count"
           FROM farm_operations o LEFT JOIN farm_units u ON u.id = o."unitId"
          WHERE ${opWhere}
          GROUP BY o."plantingId", u.path, o."farmId"`,
        opParams,
      ),
      this.dataSource.query<
        {
          id: string;
          number: string;
          farmId: string;
          unitPath: string;
          unitName: string;
          cropName: string;
          varietyName: string | null;
          plantCount: number;
          areaM2: string | null;
        }[]
      >(
        `SELECT p.id, p.number, p."farmId", u.path AS "unitPath", u.name AS "unitName",
                c.name AS "cropName", v.name AS "varietyName", p."plantCount", p."areaM2"
           FROM plantings p
           JOIN farm_units u ON u.id = p."unitId"
           JOIN crops c ON c.id = p."cropId"
           LEFT JOIN crop_varieties v ON v.id = p."varietyId"
          WHERE p."farmId" = ANY($1::uuid[]) AND p."deletedAt" IS NULL
            AND ($2::uuid IS NULL OR p."cropId" = $2)
            AND (p.status = 'active' OR EXISTS (
                  SELECT 1 FROM farm_operations o2 WHERE o2."plantingId" = p.id AND o2.status = 'done')
                 OR EXISTS (SELECT 1 FROM farm_harvests h2 WHERE h2."plantingId" = p.id))`,
        [s.farmIds, query.cropId ?? null],
      ),
      this.dataSource.query<
        { plantingId: string; quantity: string; value: string; labor: string }[]
      >(
        `SELECT h."plantingId", SUM(h.quantity) AS "quantity", SUM(h.value) AS "value",
                SUM(h."laborCost") AS "labor"
           FROM farm_harvests h
          WHERE h."farmId" = ANY($1::uuid[]) AND h."deletedAt" IS NULL AND h.status = 'recorded'
            AND h."plantingId" IS NOT NULL
            AND (h."harvestedAt" AT TIME ZONE $2)::date BETWEEN $3 AND $4
          GROUP BY h."plantingId"`,
        [s.farmIds, s.zone, s.from, s.to],
      ),
    ]);

    const acc = new Map(
      plantings.map((p) => [
        p.id,
        {
          inputs: new Decimal(0),
          labor: new Decimal(0),
          hours: new Decimal(0),
          water: new Decimal(0),
          operations: 0,
        },
      ]),
    );
    let unallocated = new Decimal(0);
    for (const op of ops) {
      const parts: { id: string; share: Decimal }[] = [];
      if (op.plantingId) {
        if (acc.has(op.plantingId))
          parts.push({ id: op.plantingId, share: new Decimal(1) });
      } else {
        const covered = plantings.filter(
          (p) =>
            p.farmId === op.farmId &&
            (!op.unitPath ||
              p.unitPath === op.unitPath ||
              p.unitPath.startsWith(`${op.unitPath}/`) ||
              op.unitPath.startsWith(`${p.unitPath}/`)),
        );
        const weights = covered.map((p) => num(p.plantCount));
        const byArea = weights.every((w) => w === 0);
        const weightOf = (p: (typeof covered)[number]) =>
          byArea ? num(p.areaM2) || 1 : num(p.plantCount);
        const total = covered.reduce((sum, p) => sum + weightOf(p), 0);
        for (const p of covered) {
          parts.push({
            id: p.id,
            share: new Decimal(weightOf(p)).div(total || 1),
          });
        }
      }
      if (!parts.length) {
        unallocated = unallocated.plus(op.inputs).plus(op.labor);
        continue;
      }
      for (const { id, share } of parts) {
        const a = acc.get(id)!;
        a.inputs = a.inputs.plus(new Decimal(op.inputs).mul(share));
        a.labor = a.labor.plus(new Decimal(op.labor).mul(share));
        a.hours = a.hours.plus(new Decimal(op.hours).mul(share));
        a.water = a.water.plus(new Decimal(op.water).mul(share));
        a.operations += num(op.count);
      }
    }
    const harvestBy = new Map(harvests.map((h) => [h.plantingId, h]));
    const rows = plantings
      .map((p) => {
        const a = acc.get(p.id)!;
        const h = harvestBy.get(p.id);
        const labor = a.labor.plus(num(h?.labor));
        const total = a.inputs.plus(labor);
        const quantity = num(h?.quantity);
        const value = num(h?.value);
        return {
          plantingId: p.id,
          number: p.number,
          label: `${p.cropName}${p.varietyName ? ` — ${p.varietyName}` : ''} (${p.unitName})`,
          plantCount: p.plantCount,
          areaM2: p.areaM2 === null ? null : num(p.areaM2),
          operations: a.operations,
          inputCost: round(a.inputs),
          laborCost: round(labor),
          laborHours: round(a.hours, 2),
          waterM3: round(a.water, 2),
          totalCost: round(total),
          harvestQuantity: quantity,
          harvestValue: value,
          costPerUnit: quantity ? round(total.div(quantity), 4) : null,
          costPerPlant: p.plantCount ? round(total.div(p.plantCount)) : null,
          margin: round(new Decimal(value).minus(total)),
        };
      })
      .filter((r) => r.totalCost || r.harvestQuantity)
      .sort((a, b) => b.totalCost - a.totalCost);
    return {
      period: { from: s.from, to: s.to },
      groupBy,
      rows,
      /** عمليات على وحدات بلا زراعة قائمة (تجهيز أرض فارغة...) */
      unallocatedCost: round(unallocated),
    };
  }

  // ══════════════════════════ الآفات ══════════════════════════

  async pests(query: FarmReportQueryDto, tenantId: string) {
    const s = await this.scope(query, tenantId, { defaultFrom: 'year' });
    const params = [s.farmIds, s.zone, s.from, s.to, s.unitPath];
    const where = `i."farmId" = ANY($1::uuid[]) AND i."deletedAt" IS NULL
        AND (i."inspectedAt" AT TIME ZONE $2)::date BETWEEN $3 AND $4
        AND ($5::text IS NULL OR u.path = $5 OR u.path LIKE $5 || '/%')`;
    const from = `farm_inspections i
        LEFT JOIN farm_plants pl ON pl.id = i."plantId"
        LEFT JOIN farm_units u ON u.id = COALESCE(i."unitId", pl."unitId")`;
    const [byPest, byMonth, byUnit] = await Promise.all([
      this.dataSource.query<
        {
          pest: string;
          pestName: string | null;
          count: string;
          open: string;
          severity: string;
          affected: string;
          sampled: string;
        }[]
      >(
        `SELECT i.pest, MAX(i."pestName") AS "pestName", COUNT(*) AS "count",
                COUNT(*) FILTER (WHERE i.status <> 'resolved') AS "open",
                AVG(i.severity) AS "severity", COALESCE(SUM(i."affectedCount"), 0) AS "affected",
                COALESCE(SUM(i."sampledCount"), 0) AS "sampled"
           FROM ${from} WHERE ${where} GROUP BY i.pest ORDER BY 3 DESC`,
        params,
      ),
      this.dataSource.query<{ month: string; pest: string; count: string }[]>(
        `SELECT to_char(i."inspectedAt" AT TIME ZONE $2, 'YYYY-MM') AS "month", i.pest, COUNT(*) AS "count"
           FROM ${from} WHERE ${where} AND i.severity > 0 GROUP BY 1, 2 ORDER BY 1`,
        params,
      ),
      this.dataSource.query<
        { unitId: string; unitName: string; count: string; severity: string }[]
      >(
        `SELECT u.id AS "unitId", u.name AS "unitName", COUNT(*) AS "count", MAX(i.severity) AS "severity"
           FROM ${from} WHERE ${where} AND i.severity > 0 AND u.id IS NOT NULL
          GROUP BY u.id, u.name ORDER BY 3 DESC LIMIT 15`,
        params,
      ),
    ]);
    return {
      period: { from: s.from, to: s.to },
      byPest: byPest.map((p) => ({
        pest: p.pest,
        pestName: p.pestName,
        inspections: num(p.count),
        open: num(p.open),
        averageSeverity: round(num(p.severity), 2),
        affected: num(p.affected),
        sampled: num(p.sampled),
        incidence: ratio(num(p.affected), num(p.sampled), 4),
      })),
      byMonth: byMonth.map((m) => ({
        month: m.month,
        pest: m.pest,
        count: num(m.count),
      })),
      byUnit: byUnit.map((u) => ({
        unitId: u.unitId,
        unitName: u.unitName,
        count: num(u.count),
        maxSeverity: num(u.severity),
      })),
    };
  }

  // ══════════════════════════ سجل النخيل ══════════════════════════

  async registry(query: FarmReportQueryDto, tenantId: string) {
    const s = await this.scope(query, tenantId, { defaultFrom: 'year' });
    const params = [s.farmIds, s.unitPath, query.cropId ?? null];
    const where = `pl."farmId" = ANY($1::uuid[]) AND pl."deletedAt" IS NULL
        AND ($2::text IS NULL OR u.path = $2 OR u.path LIKE $2 || '/%')
        AND ($3::uuid IS NULL OR p."cropId" = $3)`;
    const from = `farm_plants pl
        JOIN farm_units u ON u.id = pl."unitId"
        JOIN plantings p ON p.id = pl."plantingId"
        JOIN crops c ON c.id = p."cropId"
        LEFT JOIN crop_varieties v ON v.id = p."varietyId"`;
    const year = Number(s.today.slice(0, 4));
    const [byVariety, bySex, byAge, removals, origins] = await Promise.all([
      this.dataSource.query<
        {
          cropName: string;
          varietyName: string | null;
          status: string;
          count: string;
        }[]
      >(
        `SELECT c.name AS "cropName", v.name AS "varietyName", pl.status, COUNT(*) AS "count"
           FROM ${from} WHERE ${where} GROUP BY 1, 2, 3 ORDER BY 1, 2`,
        params,
      ),
      this.dataSource.query<{ sex: string; count: string }[]>(
        `SELECT pl.sex, COUNT(*) AS "count" FROM ${from}
          WHERE ${where} AND pl.status NOT IN ('dead', 'removed') GROUP BY 1`,
        params,
      ),
      this.dataSource.query<{ band: string; count: string }[]>(
        `SELECT CASE
                  WHEN pl."plantedAt" IS NULL THEN 'unknown'
                  WHEN ${year} - EXTRACT(YEAR FROM pl."plantedAt") < 3 THEN '0-2'
                  WHEN ${year} - EXTRACT(YEAR FROM pl."plantedAt") <= 5 THEN '3-5'
                  WHEN ${year} - EXTRACT(YEAR FROM pl."plantedAt") <= 10 THEN '6-10'
                  WHEN ${year} - EXTRACT(YEAR FROM pl."plantedAt") <= 20 THEN '11-20'
                  ELSE '20+' END AS "band", COUNT(*) AS "count"
           FROM ${from} WHERE ${where} AND pl.status NOT IN ('dead', 'removed') GROUP BY 1`,
        params,
      ),
      this.dataSource.query<{ reason: string | null; count: string }[]>(
        `SELECT pl."removalReason" AS "reason", COUNT(*) AS "count" FROM ${from}
          WHERE ${where} AND pl.status IN ('dead', 'removed') AND pl."removedAt" BETWEEN $4 AND $5
          GROUP BY 1 ORDER BY 2 DESC`,
        [...params, s.from, s.to],
      ),
      this.dataSource.query<
        { source: string; count: string; replacements: string }[]
      >(
        `SELECT pl.source, COUNT(*) AS "count",
                COUNT(*) FILTER (WHERE pl."replacesPlantId" IS NOT NULL) AS "replacements"
           FROM ${from} WHERE ${where} GROUP BY 1`,
        params,
      ),
    ]);
    const varieties = new Map<
      string,
      {
        cropName: string;
        varietyName: string | null;
        byStatus: Record<string, number>;
        live: number;
      }
    >();
    for (const r of byVariety) {
      const k = `${r.cropName}|${r.varietyName ?? ''}`;
      const entry = varieties.get(k) ?? {
        cropName: r.cropName,
        varietyName: r.varietyName,
        byStatus: {},
        live: 0,
      };
      entry.byStatus[r.status] = num(r.count);
      if (!['dead', 'removed'].includes(r.status)) entry.live += num(r.count);
      varieties.set(k, entry);
    }
    return {
      period: { from: s.from, to: s.to },
      varieties: [...varieties.values()].sort((a, b) => b.live - a.live),
      bySex: Object.fromEntries(bySex.map((r) => [r.sex, num(r.count)])),
      byAge: Object.fromEntries(byAge.map((r) => [r.band, num(r.count)])),
      removals: removals.map((r) => ({
        reason: r.reason ?? 'other',
        count: num(r.count),
      })),
      origins: origins.map((r) => ({
        source: r.source,
        count: num(r.count),
        replacements: num(r.replacements),
      })),
    };
  }

  // ══════════════════════════ المياه ══════════════════════════

  async water(query: FarmReportQueryDto, tenantId: string) {
    const s = await this.scope(query, tenantId, { defaultFrom: 'year' });
    const params = [s.farmIds, s.zone, s.from, s.to, s.unitPath];
    const where = `o."farmId" = ANY($1::uuid[]) AND o."deletedAt" IS NULL AND o.status = 'done'
        AND o."waterM3" IS NOT NULL
        AND (o."performedAt" AT TIME ZONE $2)::date BETWEEN $3 AND $4
        AND ($5::text IS NULL OR u.path = $5 OR u.path LIKE $5 || '/%')`;
    const from = `farm_operations o LEFT JOIN farm_units u ON u.id = o."unitId"`;
    const [byUnit, bySource, byMonth] = await Promise.all([
      this.dataSource.query<
        {
          unitId: string | null;
          unitName: string | null;
          area: string | null;
          water: string;
          count: string;
          minutes: string;
        }[]
      >(
        `SELECT u.id AS "unitId", u.name AS "unitName", MAX(u."areaM2") AS "area",
                SUM(o."waterM3") AS "water", COUNT(*) AS "count",
                COALESCE(SUM(o."durationMinutes"), 0) AS "minutes"
           FROM ${from} WHERE ${where} GROUP BY u.id, u.name ORDER BY 4 DESC`,
        params,
      ),
      this.dataSource.query<
        {
          sourceId: string | null;
          sourceName: string | null;
          capacity: string | null;
          water: string;
          minutes: string;
        }[]
      >(
        `SELECT ws.id AS "sourceId", ws.name AS "sourceName", MAX(ws."capacityM3PerHour") AS "capacity",
                SUM(o."waterM3") AS "water", COALESCE(SUM(o."durationMinutes"), 0) AS "minutes"
           FROM ${from} LEFT JOIN farm_water_sources ws ON ws.id = o."waterSourceId"
          WHERE ${where} GROUP BY ws.id, ws.name ORDER BY 4 DESC`,
        params,
      ),
      this.dataSource.query<{ month: string; water: string }[]>(
        `SELECT to_char(o."performedAt" AT TIME ZONE $2, 'YYYY-MM') AS "month", SUM(o."waterM3") AS "water"
           FROM ${from} WHERE ${where} GROUP BY 1 ORDER BY 1`,
        params,
      ),
    ]);
    return {
      period: { from: s.from, to: s.to },
      byUnit: byUnit.map((u) => ({
        unitId: u.unitId,
        unitName: u.unitName ?? 'المزرعة كلها',
        waterM3: num(u.water),
        irrigations: num(u.count),
        minutes: num(u.minutes),
        perHectare:
          u.area && num(u.area)
            ? round(num(u.water) / (num(u.area) / 10000), 2)
            : null,
      })),
      bySource: bySource.map((w) => ({
        sourceId: w.sourceId,
        sourceName: w.sourceName ?? 'غير محدد',
        waterM3: num(w.water),
        hours: round(num(w.minutes) / 60, 2),
        /** ساعات تشغيل لازمة بالطاقة المسجّلة مقابل الفعلية */
        capacityHours:
          w.capacity && num(w.capacity)
            ? round(num(w.water) / num(w.capacity), 2)
            : null,
      })),
      byMonth: byMonth.map((m) => ({ month: m.month, waterM3: num(m.water) })),
    };
  }

  // ══════════════════════════ مساعدات ══════════════════════════

  /** المزارع المرئية (أو واحدة)، الفترة (افتراضياً من أول السنة)، والوحدة */
  private async scope(
    query: FarmReportQueryDto,
    tenantId: string,
    { defaultFrom }: { defaultFrom: 'year' },
  ): Promise<Scope> {
    const zone = await tenantTimezoneOf(this.dataSource.manager, tenantId);
    const today = dayKeyInZone(new Date(), zone);
    const visible = (await this.farms.findAll(tenantId)).map((f) => f.id);
    let farmIds = visible;
    if (query.farmId) {
      if (!visible.includes(query.farmId))
        throw new NotFoundException('المزرعة غير موجودة');
      farmIds = [query.farmId];
    }
    let unitPath: string | null = null;
    if (query.unitId) {
      const unit = await this.farms.unitOf(
        this.dataSource.manager,
        query.unitId,
        tenantId,
      );
      if (!farmIds.includes(unit.farmId))
        throw new NotFoundException('الوحدة غير موجودة');
      unitPath = unit.path;
    }
    return {
      farmIds,
      zone,
      today,
      from:
        query.from ??
        (defaultFrom === 'year' ? `${today.slice(0, 4)}-01-01` : today),
      to: query.to ?? today,
      unitPath,
    };
  }

  /** أسماء المفاتيح المجمّعة (صنف، وحدة، منتج) */
  private async labels(
    groupBy: string,
    keys: string[],
  ): Promise<Map<string, string>> {
    if (!keys.length || groupBy === 'month')
      return new Map(keys.map((k) => [k, k]));
    const sql = {
      variety: `SELECT v.id::text AS "key", c.name || ' — ' || v.name AS "label"
                  FROM crop_varieties v JOIN crops c ON c.id = v."cropId"
                 WHERE v.id::text = ANY($1)
                UNION ALL
                SELECT c.id::text, c.name FROM crops c WHERE c.id::text = ANY($1)`,
      unit: `SELECT id::text AS "key", name AS "label" FROM farm_units WHERE id::text = ANY($1)`,
      type: `SELECT id::text AS "key", name AS "label" FROM products WHERE id::text = ANY($1)`,
    }[groupBy];
    if (!sql) return new Map();
    const rows = await this.dataSource.query<{ key: string; label: string }[]>(
      sql,
      [keys],
    );
    return new Map(rows.map((r) => [r.key, r.label]));
  }
}
