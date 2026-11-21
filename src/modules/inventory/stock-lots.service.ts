// src/modules/inventory/stock-lots.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type {
  EntryManagerLike,
  LotAllocation,
  LotInput,
  LotPick,
  LotsFrom,
} from './stock-lots.types';
import { StockLot, StockLotSource } from './entities/stock-lot.entity';

/** خانات الكميات: numeric(14,4) */
const SCALE = 4;

interface AvailableLot {
  lotId: string;
  quantity: Decimal;
}

/** ما يحتاجه التوزيع عن الحركة التي سُجّلت للتو */
export interface LotMovementContext {
  tenantId: string;
  warehouseId: string;
  productId: string;
  productName: string;
  shelfLifeDays: number | null;
  movementId: string;
  /** كمية الحركة بإشارتها */
  quantity: Decimal;
  /** رصيد الصنف في المخزن قبل الحركة */
  previousQuantity: Decimal;
  occurredAt: Date;
  /** البيع الواقع فعلاً لا يُرفض لنقص دفعة مختارة */
  allowShortfall: boolean;
  lot?: LotInput;
  lots?: LotPick[];
  lotsFrom?: LotsFrom;
}

/**
 * توزيع حركات المخزون على الدفعات. يعمل داخل معاملة StockService.apply وبعد
 * قفل الصنف، فحركات نفس الصنف لا تتزاحم على نفس الدفعة.
 *
 * الدخول: دفعة الحركة (تُنشأ إن لم توجد)، أو توزيع صريح، أو دفعات مستند سابق
 * (lotsFrom: مرتجع البيع يعود لدفعات البيع)، والباقي غير معيّن.
 *
 * الخروج بالترتيب: الصريح، ثم دفعات المستند السابق (مرتجع الشراء من دفعات
 * الشراء)، ثم الرصيد غير المعيّن (الأقدم: سبق تفعيل التتبع)، ثم الأقرب انتهاءً
 * من الدفعات السارية (FEFO) ثم المنتهية، وما يتجاوز كل ذلك غير معيّن (بيع
 * تجاوز الرصيد).
 */
@Injectable()
export class StockLotsService {
  async allocate(
    manager: EntryManagerLike,
    ctx: LotMovementContext,
  ): Promise<LotAllocation[]> {
    if (ctx.quantity.isZero()) return [];
    const allocations = ctx.quantity.gt(0)
      ? await this.incoming(manager, ctx)
      : await this.outgoing(manager, ctx);

    for (const allocation of allocations) {
      await manager.query(
        `INSERT INTO stock_movement_lots ("tenantId", "movementId", "lotId", "quantity")
         VALUES ($1, $2, $3, $4)`,
        [
          ctx.tenantId,
          ctx.movementId,
          allocation.lotId,
          allocation.quantity.toFixed(SCALE),
        ],
      );
      if (allocation.lotId) {
        await manager.query(
          `INSERT INTO stock_lot_levels ("tenantId", "warehouseId", "productId", "lotId", "quantity")
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT ("warehouseId", "lotId")
           DO UPDATE SET "quantity" = stock_lot_levels."quantity" + EXCLUDED."quantity",
                         "updatedAt" = now()`,
          [
            ctx.tenantId,
            ctx.warehouseId,
            ctx.productId,
            allocation.lotId,
            allocation.quantity.toFixed(SCALE),
          ],
        );
      }
    }
    return allocations.map((a) => ({
      lotId: a.lotId,
      quantity: a.quantity.toDecimalPlaces(SCALE).toNumber(),
    }));
  }

  /**
   * الدفعة برقمها للصنف، تُنشأ إن لم توجد. تاريخ انتهاء غائب يُقترح من مدة
   * صلاحية الصنف (من تاريخ الإنتاج أو يوم الحركة).
   */
  async upsertLot(
    manager: EntryManagerLike,
    tenantId: string,
    productId: string,
    input: LotInput,
    shelfLifeDays: number | null,
    occurredAt: Date,
  ): Promise<StockLot> {
    const lotNumber = input.lotNumber.trim();
    if (!lotNumber) throw new BadRequestException('رقم الدفعة مطلوب');
    const [existing] = await manager.query<StockLot[]>(
      `SELECT * FROM stock_lots
        WHERE "tenantId" = $1 AND "productId" = $2 AND "lotNumber" = $3`,
      [tenantId, productId, lotNumber],
    );
    if (existing) {
      // دفعة معروفة: ما كان ناقصاً من بياناتها يُكمَّل، والموجود لا يُغيَّر
      if (
        (!existing.expiryDate && input.expiryDate) ||
        (!existing.manufactureDate && input.manufactureDate)
      ) {
        await manager.query(
          `UPDATE stock_lots
              SET "expiryDate" = COALESCE("expiryDate", $2),
                  "manufactureDate" = COALESCE("manufactureDate", $3),
                  "updatedAt" = now()
            WHERE "id" = $1`,
          [
            existing.id,
            input.expiryDate ?? null,
            input.manufactureDate ?? null,
          ],
        );
      }
      return existing;
    }

    const base = input.manufactureDate ?? occurredAt.toISOString().slice(0, 10);
    const expiryDate =
      input.expiryDate ?? (shelfLifeDays ? addDays(base, shelfLifeDays) : null);
    const [created] = await manager.query<StockLot[]>(
      `INSERT INTO stock_lots
         ("tenantId", "productId", "lotNumber", "expiryDate", "manufactureDate",
          "source", "sourceType", "sourceId", "supplierId", "note")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        tenantId,
        productId,
        lotNumber,
        expiryDate,
        input.manufactureDate ?? null,
        input.source ?? StockLotSource.OTHER,
        input.sourceType ?? null,
        input.sourceId ?? null,
        input.supplierId ?? null,
        input.note ?? null,
      ],
    );
    return created;
  }

  // ══════════════════════════ الدخول ══════════════════════════

  private async incoming(
    manager: EntryManagerLike,
    ctx: LotMovementContext,
  ): Promise<{ lotId: string | null; quantity: Decimal }[]> {
    let remaining = ctx.quantity;
    const result: { lotId: string | null; quantity: Decimal }[] = [];

    if (ctx.lot) {
      const lot = await this.upsertLot(
        manager,
        ctx.tenantId,
        ctx.productId,
        ctx.lot,
        ctx.shelfLifeDays,
        ctx.occurredAt,
      );
      return [{ lotId: lot.id, quantity: remaining }];
    }

    const sources: AvailableLot[] = [];
    if (ctx.lots?.length) {
      await this.assertLotsOfProduct(manager, ctx, ctx.lots);
      sources.push(
        ...ctx.lots.map((l) => ({
          lotId: l.lotId,
          quantity: new Decimal(l.quantity),
        })),
      );
    }
    if (ctx.lotsFrom) {
      // ما أخرجه المستند السابق من كل دفعة (بالموجب)
      sources.push(...(await this.referenceLots(manager, ctx, 'out')));
    }
    for (const source of sources) {
      if (remaining.lte(0)) break;
      const take = Decimal.min(source.quantity, remaining);
      if (take.lte(0)) continue;
      result.push({ lotId: source.lotId, quantity: take });
      remaining = remaining.minus(take);
    }
    if (remaining.gt(0)) result.push({ lotId: null, quantity: remaining });
    return merge(result);
  }

  // ══════════════════════════ الخروج ══════════════════════════

  private async outgoing(
    manager: EntryManagerLike,
    ctx: LotMovementContext,
  ): Promise<{ lotId: string | null; quantity: Decimal }[]> {
    let need = ctx.quantity.neg();
    const result: { lotId: string | null; quantity: Decimal }[] = [];
    const available = await this.availableLots(manager, ctx);
    const availableOf = new Map(available.map((l) => [l.lotId, l.quantity]));

    const take = (lotId: string | null, wanted: Decimal) => {
      if (need.lte(0) || wanted.lte(0)) return;
      let quantity = Decimal.min(wanted, need);
      if (lotId) {
        const left = availableOf.get(lotId) ?? new Decimal(0);
        quantity = Decimal.min(quantity, left);
        if (quantity.lte(0)) return;
        availableOf.set(lotId, left.minus(quantity));
      }
      result.push({ lotId, quantity: quantity.neg() });
      need = need.minus(quantity);
    };

    // 1) الصريح: نقصه عن الطلب خطأ إلا لبيع وقع فعلاً
    if (ctx.lots?.length) {
      await this.assertLotsOfProduct(manager, ctx, ctx.lots);
      for (const pick of ctx.lots) {
        const wanted = new Decimal(pick.quantity);
        const left = availableOf.get(pick.lotId) ?? new Decimal(0);
        if (wanted.gt(left) && !ctx.allowShortfall) {
          const [lot] = await manager.query<{ lotNumber: string }[]>(
            `SELECT "lotNumber" FROM stock_lots WHERE "id" = $1`,
            [pick.lotId],
          );
          throw new BadRequestException(
            `الدفعة "${lot?.lotNumber ?? ''}" من "${ctx.productName}" لا يكفي رصيدها: المتاح ${left.toNumber()}`,
          );
        }
        take(pick.lotId, wanted);
      }
    }

    // 2) دفعات المستند السابق (مرتجع شراء ← دفعات فاتورة الشراء)
    if (ctx.lotsFrom) {
      for (const source of await this.referenceLots(manager, ctx, 'in')) {
        take(source.lotId, source.quantity);
      }
    }

    // 3) غير المعيّن أولاً: رصيد سبق تفعيل التتبع هو الأقدم
    if (need.gt(0)) {
      const assigned = available.reduce(
        (sum, l) => sum.plus(l.quantity),
        new Decimal(0),
      );
      const unassigned = ctx.previousQuantity.minus(assigned);
      if (unassigned.gt(0)) take(null, unassigned);
    }

    // 4) FEFO: السارية بالأقرب انتهاءً، ثم بلا تاريخ، ثم المنتهية
    for (const lot of available) {
      take(lot.lotId, availableOf.get(lot.lotId) ?? new Decimal(0));
    }

    // 5) ما زاد عن كل الرصيد: خروج غير معيّن (بيع تجاوز الرصيد)
    if (need.gt(0)) result.push({ lotId: null, quantity: need.neg() });
    return merge(result);
  }

  /** دفعات الصنف ذات الرصيد في المخزن بترتيب FEFO */
  private async availableLots(
    manager: EntryManagerLike,
    ctx: LotMovementContext,
  ): Promise<AvailableLot[]> {
    const rows = await manager.query<{ lotId: string; quantity: string }[]>(
      `SELECT lv."lotId", lv."quantity"
         FROM stock_lot_levels lv
         JOIN stock_lots l ON l."id" = lv."lotId"
        WHERE lv."warehouseId" = $1 AND lv."productId" = $2 AND lv."quantity" > 0
        ORDER BY (l."expiryDate" IS NOT NULL AND l."expiryDate" < $3::date) ASC,
                 l."expiryDate" ASC NULLS LAST,
                 l."createdAt" ASC`,
      [
        ctx.warehouseId,
        ctx.productId,
        ctx.occurredAt.toISOString().slice(0, 10),
      ],
    );
    return rows.map((r) => ({
      lotId: r.lotId,
      quantity: new Decimal(r.quantity),
    }));
  }

  /**
   * نصيب كل دفعة من حركات مستند سابق لنفس الصنف: 'out' ما أخرجه (البيع،
   * إرسال التحويل)، و'in' ما أدخله (الشراء) — بالموجب.
   */
  private async referenceLots(
    manager: EntryManagerLike,
    ctx: LotMovementContext,
    direction: 'in' | 'out',
  ): Promise<AvailableLot[]> {
    const rows = await manager.query<{ lotId: string; quantity: string }[]>(
      `SELECT ml."lotId", ABS(SUM(ml."quantity")) AS "quantity"
         FROM stock_movement_lots ml
         JOIN stock_movements m ON m."id" = ml."movementId"
        WHERE m."tenantId" = $1 AND m."referenceType" = $2 AND m."referenceId" = $3
          AND m."productId" = $4 AND ml."lotId" IS NOT NULL
          AND ml."quantity" ${direction === 'out' ? '<' : '>'} 0
        GROUP BY ml."lotId"
        ORDER BY MIN(m."occurredAt") ASC`,
      [
        ctx.tenantId,
        ctx.lotsFrom!.referenceType,
        ctx.lotsFrom!.referenceId,
        ctx.productId,
      ],
    );
    return rows.map((r) => ({
      lotId: r.lotId,
      quantity: new Decimal(r.quantity),
    }));
  }

  private async assertLotsOfProduct(
    manager: EntryManagerLike,
    ctx: LotMovementContext,
    picks: LotPick[],
  ): Promise<void> {
    const ids = [...new Set(picks.map((p) => p.lotId))];
    const rows = await manager.query<{ id: string }[]>(
      `SELECT "id" FROM stock_lots
        WHERE "tenantId" = $1 AND "productId" = $2 AND "id" = ANY($3::uuid[])`,
      [ctx.tenantId, ctx.productId, ids],
    );
    if (rows.length !== ids.length) {
      throw new BadRequestException(`دفعة لا تخص الصنف "${ctx.productName}"`);
    }
  }
}

/** أنصبة الدفعة الواحدة تُجمع في سطر */
function merge(
  rows: { lotId: string | null; quantity: Decimal }[],
): { lotId: string | null; quantity: Decimal }[] {
  const byLot = new Map<string | null, Decimal>();
  for (const row of rows) {
    byLot.set(
      row.lotId,
      (byLot.get(row.lotId) ?? new Decimal(0)).plus(row.quantity),
    );
  }
  return [...byLot.entries()]
    .filter(([, quantity]) => !quantity.isZero())
    .map(([lotId, quantity]) => ({ lotId, quantity }));
}

/** تاريخ (YYYY-MM-DD) + أيام بلا تأثر بالمنطقة الزمنية */
export function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
