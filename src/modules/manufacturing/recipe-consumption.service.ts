// src/modules/manufacturing/recipe-consumption.service.ts
import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { EntityManager, In } from 'typeorm';
import { Product, ProductType } from '../catalog/entities/product.entity';
import { BomsService, MAX_BOM_DEPTH } from './boms.service';
import { Bom, BomKind } from './entities/bom.entity';

/** صنف مركّب بيع (أو هُلك) بكمية، وما غيّرته الإضافات في وصفته */
export interface ConsumptionItem {
  /** الصنف المركّب نفسه؛ null = الإضافات وحدها (صنف مخزني يخرج ببيعه العادي) */
  productId: string | null;
  /** بوحدة أساس الصنف المباع */
  quantity: number;
  /** مكوّنات تُضاف لكل وحدة (إضافة "جبنة زيادة"، صنف في وجبة) */
  extras?: { productId: string; quantity: number }[];
  /** مكوّنات الوصفة المحذوفة ("بدون بصل") — المستوى الأول فقط */
  removals?: string[];
}

/** ما يُخصم من المخزون لكل صنف مباع: مكوّن ← كمية بوحدة أساسه */
export type Consumption = Map<string, Decimal>;

/**
 * فك الأصناف المركّبة إلى مكوّناتها المخزنية عند البيع: الوصفة الافتراضية
 * بكمية البيع، والوصفات الفرعية (صلصة داخل طبق) تُفك بدورها، والإضافات
 * تُضاف والمحذوفات تُطرح. مركّب بلا وصفة فعّالة لا يخصم شيئاً (كالخدمة).
 */
@Injectable()
export class RecipeConsumptionService {
  constructor(private readonly boms: BomsService) {}

  async explode(
    manager: EntityManager,
    tenantId: string,
    items: ConsumptionItem[],
  ): Promise<Consumption[]> {
    const recipes = new Map<string, Bom | null>();
    const types = new Map<string, ProductType>();

    const typeOf = async (ids: string[]) => {
      const missing = [...new Set(ids)].filter((id) => !types.has(id));
      if (!missing.length) return;
      const found = await manager.find(Product, {
        where: { tenantId, id: In(missing) },
        select: ['id', 'type'],
        withDeleted: true,
      });
      for (const p of found) types.set(p.id, p.type);
    };
    const recipeOf = async (productId: string) => {
      if (!recipes.has(productId)) {
        recipes.set(
          productId,
          await this.boms.defaultFor(
            productId,
            BomKind.RECIPE,
            tenantId,
            manager,
          ),
        );
      }
      return recipes.get(productId)!;
    };

    const add = async (
      into: Consumption,
      productId: string,
      quantity: Decimal,
      depth: number,
      removals: Set<string> = new Set(),
    ): Promise<void> => {
      if (quantity.lte(0)) return;
      await typeOf([productId]);
      const type = types.get(productId);
      if (type === ProductType.STOCKED) {
        into.set(
          productId,
          (into.get(productId) ?? new Decimal(0)).plus(quantity),
        );
        return;
      }
      if (type !== ProductType.COMPOSITE || depth >= MAX_BOM_DEPTH) return;
      const recipe = await recipeOf(productId);
      if (!recipe) return;
      const factor = quantity.div(recipe.outputQuantity || 1);
      await typeOf((recipe.lines ?? []).map((l) => l.componentId));
      for (const line of recipe.lines ?? []) {
        if (removals.has(line.componentId)) continue;
        await add(
          into,
          line.componentId,
          new Decimal(line.quantity)
            .mul(factor)
            .mul(new Decimal(1).plus(new Decimal(line.scrapPercent).div(100))),
          depth + 1,
        );
      }
    };

    const result: Consumption[] = [];
    for (const item of items) {
      const consumption: Consumption = new Map();
      const quantity = new Decimal(item.quantity);
      if (item.productId) {
        await add(
          consumption,
          item.productId,
          quantity,
          0,
          new Set(item.removals ?? []),
        );
      }
      for (const extra of item.extras ?? []) {
        await add(
          consumption,
          extra.productId,
          new Decimal(extra.quantity).mul(quantity),
          1,
        );
      }
      for (const [id, qty] of consumption) {
        consumption.set(id, qty.toDecimalPlaces(4));
      }
      result.push(consumption);
    }
    return result;
  }
}
