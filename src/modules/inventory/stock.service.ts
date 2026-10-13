// src/modules/inventory/stock.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { moneyDecimalsOf, roundMoney } from '../../common/utils/money.util';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { Product, ProductType } from '../catalog/entities/product.entity';
import { ProductsService } from '../catalog/products.service';
import {
  CreateAdjustmentDto,
  MovementQueryDto,
  SetMinQuantityDto,
  StockQueryDto,
} from './dto/inventory.dto';
import { InventoryItem } from './entities/inventory-item.entity';
import { StockLevel } from './entities/stock-level.entity';
import {
  StockMovement,
  StockMovementType,
} from './entities/stock-movement.entity';
import { Warehouse } from './entities/warehouse.entity';
import { WarehousesService } from './warehouses.service';

/** خانات الكميات والتكلفة في قاعدة البيانات: numeric(14,4) */
const SCALE = 4;

/** حركة مطلوب تسجيلها على المخزون */
export interface StockEntry {
  warehouseId: string;
  productId: string;
  type: StockMovementType;
  /** بوحدة الأساس: موجبة = دخول، سالبة = خروج */
  quantity?: number;
  /** بديل عن quantity: اجعل الرصيد يساوي هذه القيمة (الجرد) */
  targetQuantity?: number;
  /**
   * تكلفة الوحدة لبضاعة داخلة بتكلفة جديدة (شراء / رصيد افتتاحي) — تدخل في
   * المتوسط المرجّح. بدونها تُسجَّل الحركة بالمتوسط الحالي ولا يتغيّر.
   */
  unitCost?: number;
  note?: string;
}

/** المستند والمستخدم صاحبا الحركات */
export interface StockContext {
  referenceType?: string;
  referenceId?: string;
  userId?: string;
  occurredAt?: Date;
}

export interface StockResult {
  /** null إذا لم يكن هناك فرق (جرد مطابق للرصيد) */
  movement: StockMovement | null;
  previousQuantity: number;
  /** تكلفة الوحدة المسجّلة على الحركة */
  unitCost: number;
}

/** صف في شاشة الأرصدة */
export interface StockRow {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string | null;
  quantity: number;
  minQuantity: number | null;
  avgCost: number;
  value: number;
  status: 'ok' | 'low' | 'negative';
}

export interface StockSummary {
  /** عدد الأرصدة (صنف × مخزن) */
  items: number;
  /** قيمة المخزون بمتوسط التكلفة (الأرصدة السالبة لا تُحسب) */
  value: number;
  low: number;
  negative: number;
  /** قيمة البضاعة في الطريق بين المخازن (للشركة كلها) */
  inTransitValue: number;
}

/** صنف في قائمة اختيار الأصناف داخل مستندات المخزون */
export interface StockLookupRow {
  productId: string;
  name: string;
  sku: string;
  unit: string | null;
  allowsFractions: boolean;
  quantity: number;
  avgCost: number;
}

interface ItemRow {
  avgCost: string;
  inTransitQuantity: string;
}

@Injectable()
export class StockService {
  constructor(
    @InjectRepository(StockLevel)
    private readonly levels: Repository<StockLevel>,
    @InjectRepository(StockMovement)
    private readonly movements: Repository<StockMovement>,
    @InjectRepository(InventoryItem)
    private readonly items: Repository<InventoryItem>,
    private readonly warehouses: WarehousesService,
    private readonly products: ProductsService,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════ الكتابة ══════════════════════════

  /**
   * المدخل الوحيد لتغيير أي رصيد — تستخدمه التسويات والتحويلات والجرد،
   * ولاحقاً المشتريات والمبيعات.
   *
   * يعمل داخل معاملة المستدعي (manager): إن فشل أي سطر تُلغى الحركات كلها
   * مع المستند. لكل سطر: يقفل الصنف، يحدّث متوسط التكلفة إن لزم، يحدّث
   * الرصيد، ثم يكتب سطراً في دفتر الحركات.
   */
  async apply(
    manager: EntityManager,
    tenantId: string,
    entries: StockEntry[],
    context: StockContext = {},
  ): Promise<StockResult[]> {
    if (entries.length === 0) return [];

    const warehouses = new Map(
      (
        await this.warehouses.findActiveByIds(
          entries.map((e) => e.warehouseId),
          tenantId,
          manager,
        )
      ).map((w) => [w.id, w]),
    );
    const products = await this.loadStockedProducts(
      entries.map((e) => e.productId),
      tenantId,
      manager,
    );

    // ترتيب ثابت للأقفال (صنف ثم مخزن) يمنع الـ deadlock بين معاملتين
    const order = entries
      .map((entry, index) => ({ entry, index }))
      .sort(
        (a, b) =>
          a.entry.productId.localeCompare(b.entry.productId) ||
          a.entry.warehouseId.localeCompare(b.entry.warehouseId),
      );

    const results = new Array<StockResult>(entries.length);
    for (const { entry, index } of order) {
      results[index] = await this.applyOne(
        manager,
        tenantId,
        entry,
        context,
        warehouses.get(entry.warehouseId)!,
        products.get(entry.productId)!,
      );
    }
    return results;
  }

  /** تعديل الكمية "في الطريق" لصنف (إرسال تحويل +، استلامه أو إلغاؤه −) */
  async adjustInTransit(
    manager: EntityManager,
    tenantId: string,
    productId: string,
    delta: number,
  ): Promise<void> {
    await this.lockItem(manager, tenantId, productId);
    await manager.query(
      `UPDATE inventory_items
          SET "inTransitQuantity" = "inTransitQuantity" + $3, "updatedAt" = now()
        WHERE "tenantId" = $1 AND "productId" = $2`,
      [tenantId, productId, delta],
    );
  }

  /** رصيد افتتاحي أو تسوية يدوية (تالف، فاقد، زيادة...) */
  async adjust(
    dto: CreateAdjustmentDto,
    tenantId: string,
    userId?: string,
  ): Promise<StockMovement[]> {
    assertNoDuplicateProducts(dto.lines.map((l) => l.productId));

    for (const line of dto.lines) {
      if (dto.type === StockMovementType.OPENING && line.quantity < 0) {
        throw new BadRequestException(
          'الرصيد الافتتاحي كمية داخلة فقط (موجبة)',
        );
      }
      if (line.unitCost !== undefined && line.quantity < 0) {
        throw new BadRequestException('التكلفة تُدخل للكميات الداخلة فقط');
      }
    }

    const results = await this.dataSource.transaction((manager) =>
      this.apply(
        manager,
        tenantId,
        dto.lines.map((line) => ({
          warehouseId: dto.warehouseId,
          productId: line.productId,
          type: dto.type,
          quantity: line.quantity,
          unitCost: line.unitCost,
          note: dto.note,
        })),
        { referenceType: 'adjustment', userId },
      ),
    );
    return results.map((r) => r.movement!);
  }

  /** حد إعادة الطلب لصنف في مخزن */
  async setMinQuantity(
    dto: SetMinQuantityDto,
    tenantId: string,
  ): Promise<void> {
    await this.warehouses.findOne(dto.warehouseId, tenantId);
    await this.loadStockedProducts([dto.productId], tenantId);

    await this.levels.query(
      `INSERT INTO stock_levels ("tenantId", "warehouseId", "productId", "quantity", "minQuantity")
       VALUES ($1, $2, $3, 0, $4)
       ON CONFLICT ("warehouseId", "productId")
       DO UPDATE SET "minQuantity" = EXCLUDED."minQuantity"`,
      [tenantId, dto.warehouseId, dto.productId, dto.minQuantity ?? null],
    );
  }

  // ══════════════════════════ القراءة ══════════════════════════

  async findLevels(
    tenantId: string,
    query: StockQueryDto,
  ): Promise<Paginated<StockRow>> {
    const { page, limit, skip } = resolvePagination(query);

    const qb = this.levels
      .createQueryBuilder('level')
      // innerJoin: الصنف أو المخزن المحذوف يختفي رصيده من الشاشة
      .innerJoinAndSelect('level.product', 'product')
      .leftJoinAndSelect('product.baseUnit', 'baseUnit')
      .innerJoinAndSelect('level.warehouse', 'warehouse')
      .leftJoinAndMapOne(
        'level.item',
        InventoryItem,
        'item',
        'item.tenantId = level.tenantId AND item.productId = level.productId',
      )
      .where('level.tenantId = :tenantId', { tenantId });

    if (query.warehouseId) {
      qb.andWhere('level.warehouseId = :warehouseId', {
        warehouseId: query.warehouseId,
      });
    }
    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        '(product.name ILIKE :like OR product.nameEn ILIKE :like OR product.sku ILIKE :like)',
        { like: `%${search}%` },
      );
    }
    if (query.alert === 'negative') {
      qb.andWhere('level.quantity < 0');
    } else if (query.alert === 'low') {
      qb.andWhere(
        'level.minQuantity IS NOT NULL AND level.quantity >= 0 AND level.quantity <= level.minQuantity',
      );
    }

    const [rows, total] = await qb
      .orderBy('product.name', 'ASC')
      .addOrderBy('warehouse.name', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    const decimals = await moneyDecimalsOf(this.dataSource.manager, tenantId);
    return paginated(
      rows.map((row) => toStockRow(row, decimals)),
      total,
      page,
      limit,
    );
  }

  async summary(tenantId: string, warehouseId?: string): Promise<StockSummary> {
    const params: string[] = [tenantId];
    if (warehouseId) params.push(warehouseId);

    const [row] = await this.levels.query<
      { items: number; value: string; low: number; negative: number }[]
    >(
      `SELECT COUNT(*)::int AS "items",
              COALESCE(SUM(GREATEST(l."quantity", 0) * COALESCE(i."avgCost", 0)), 0) AS "value",
              (COUNT(*) FILTER (WHERE l."quantity" < 0))::int AS "negative",
              (COUNT(*) FILTER (WHERE l."minQuantity" IS NOT NULL
                                  AND l."quantity" >= 0
                                  AND l."quantity" <= l."minQuantity"))::int AS "low"
         FROM stock_levels l
         JOIN products p ON p."id" = l."productId" AND p."deletedAt" IS NULL
         JOIN warehouses w ON w."id" = l."warehouseId" AND w."deletedAt" IS NULL
         LEFT JOIN inventory_items i
                ON i."tenantId" = l."tenantId" AND i."productId" = l."productId"
        WHERE l."tenantId" = $1 ${warehouseId ? 'AND l."warehouseId" = $2' : ''}`,
      params,
    );

    const [transit] = await this.items.query<{ value: string }[]>(
      `SELECT COALESCE(SUM("inTransitQuantity" * "avgCost"), 0) AS "value"
         FROM inventory_items WHERE "tenantId" = $1`,
      [tenantId],
    );

    const decimals = await moneyDecimalsOf(this.dataSource.manager, tenantId);
    return {
      items: row.items,
      value: roundMoney(row.value, decimals),
      low: row.low,
      negative: row.negative,
      inTransitValue: roundMoney(transit.value, decimals),
    };
  }

  async findMovements(
    tenantId: string,
    query: MovementQueryDto,
  ): Promise<Paginated<StockMovement>> {
    const { page, limit, skip } = resolvePagination(query);

    const qb = this.movements
      .createQueryBuilder('movement')
      // الدفتر يعرض الحركات حتى لو حُذف الصنف أو المخزن لاحقاً
      .withDeleted()
      .leftJoinAndSelect('movement.product', 'product')
      .leftJoinAndSelect('movement.warehouse', 'warehouse')
      .where('movement.tenantId = :tenantId', { tenantId });

    if (query.warehouseId) {
      qb.andWhere('movement.warehouseId = :warehouseId', {
        warehouseId: query.warehouseId,
      });
    }
    if (query.productId) {
      qb.andWhere('movement.productId = :productId', {
        productId: query.productId,
      });
    }
    if (query.type) {
      qb.andWhere('movement.type = :type', { type: query.type });
    }
    if (query.from) {
      qb.andWhere('movement.occurredAt >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('movement.occurredAt <= :to', { to: query.to });
    }

    const [data, total] = await qb
      .orderBy('movement.occurredAt', 'DESC')
      .addOrderBy('movement.createdAt', 'DESC')
      .addOrderBy('movement.id', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return paginated(data, total, page, limit);
  }

  /**
   * بحث عن أصناف مخزنية لإضافتها في مستند (تحويل/جرد/تسوية) مع رصيدها في
   * المخزن المحدد. البحث نفسه يتم عبر موديول الأصناف.
   */
  async lookup(
    tenantId: string,
    warehouseId: string,
    search?: string,
  ): Promise<StockLookupRow[]> {
    await this.warehouses.findOne(warehouseId, tenantId);

    const { data: products } = await this.products.findAll(tenantId, {
      search,
      type: ProductType.STOCKED,
      isActive: 'true',
      limit: 20,
    });
    if (products.length === 0) return [];

    const productIds = products.map((p) => p.id);
    const [levels, items] = await Promise.all([
      this.levels.find({
        where: { tenantId, warehouseId, productId: In(productIds) },
      }),
      this.items.find({ where: { tenantId, productId: In(productIds) } }),
    ]);
    const quantityOf = new Map(levels.map((l) => [l.productId, l.quantity]));
    const costOf = new Map(items.map((i) => [i.productId, i.avgCost]));

    return products.map((product) => ({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      unit: product.baseUnit?.name ?? null,
      allowsFractions: product.baseUnit?.allowsFractions ?? false,
      quantity: quantityOf.get(product.id) ?? 0,
      avgCost: costOf.get(product.id) ?? 0,
    }));
  }

  /** أرصدة أصناف محددة في مخزن (الغائب = صفر) */
  async getQuantities(
    tenantId: string,
    warehouseId: string,
    productIds: string[],
  ): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const levels = await this.levels.find({
      where: { tenantId, warehouseId, productId: In(productIds) },
    });
    return new Map(levels.map((l) => [l.productId, l.quantity]));
  }

  // ══════════════════════════ داخلي ══════════════════════════

  private async applyOne(
    manager: EntityManager,
    tenantId: string,
    entry: StockEntry,
    context: StockContext,
    warehouse: Warehouse,
    product: Product,
  ): Promise<StockResult> {
    const item = await this.lockItem(manager, tenantId, entry.productId);
    const current = await this.currentQuantity(
      manager,
      entry.warehouseId,
      entry.productId,
    );

    const delta =
      entry.targetQuantity !== undefined
        ? new Decimal(entry.targetQuantity).minus(current)
        : new Decimal(entry.quantity ?? 0);

    let avgCost = new Decimal(item.avgCost);

    if (delta.isZero()) {
      if (entry.targetQuantity === undefined) {
        throw new BadRequestException('الكمية لا يمكن أن تكون صفراً');
      }
      return {
        movement: null,
        previousQuantity: current.toNumber(),
        unitCost: avgCost.toNumber(),
      };
    }

    const incomingCost =
      entry.unitCost !== undefined && delta.gt(0)
        ? new Decimal(entry.unitCost)
        : null;

    if (incomingCost) {
      // المتوسط المرجّح = (قيمة الموجود + قيمة الداخل) ÷ (الكميتين معاً)
      // "الموجود" = كل مخازن الشركة + ما في الطريق بينها
      const onHand = (await this.totalQuantity(manager, tenantId, product.id))
        .plus(item.inTransitQuantity)
        .toDecimalPlaces(SCALE);

      avgCost = (
        onHand.lte(0)
          ? incomingCost // لا رصيد (أو سالب): التكلفة الجديدة هي المتوسط
          : onHand
              .mul(avgCost)
              .plus(delta.mul(incomingCost))
              .div(onHand.plus(delta))
      ).toDecimalPlaces(SCALE);

      await manager.query(
        `UPDATE inventory_items
            SET "avgCost" = $3, "lastCost" = $4, "updatedAt" = now()
          WHERE "tenantId" = $1 AND "productId" = $2`,
        [tenantId, product.id, avgCost.toFixed(SCALE), incomingCost.toFixed()],
      );
    }

    const balance = current.plus(delta);
    if (delta.lt(0) && balance.lt(0) && !warehouse.allowNegativeStock) {
      throw new BadRequestException(
        `الرصيد غير كافٍ للصنف "${product.name}" في "${warehouse.name}": المتاح ${current.toNumber()}`,
      );
    }

    await manager.query(
      `INSERT INTO stock_levels ("tenantId", "warehouseId", "productId", "quantity")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("warehouseId", "productId")
       DO UPDATE SET "quantity" = EXCLUDED."quantity", "updatedAt" = now()`,
      [tenantId, warehouse.id, product.id, balance.toFixed(SCALE)],
    );

    const unitCost = (incomingCost ?? avgCost).toNumber();
    const movement = await manager.save(
      manager.create(StockMovement, {
        tenantId,
        warehouseId: warehouse.id,
        productId: product.id,
        type: entry.type,
        quantity: delta.toDecimalPlaces(SCALE).toNumber(),
        unitCost,
        balanceAfter: balance.toDecimalPlaces(SCALE).toNumber(),
        referenceType: context.referenceType ?? null,
        referenceId: context.referenceId ?? null,
        note: entry.note ?? null,
        createdById: context.userId ?? null,
        occurredAt: context.occurredAt ?? new Date(),
      }),
    );

    return { movement, previousQuantity: current.toNumber(), unitCost };
  }

  /**
   * يقفل سجل الصنف المخزني (وينشئه إن لم يوجد) حتى نهاية المعاملة: أي حركة
   * أخرى على نفس الصنف تنتظر، فلا يُقرأ رصيد أو متوسط قديم.
   */
  private async lockItem(
    manager: EntityManager,
    tenantId: string,
    productId: string,
  ): Promise<ItemRow> {
    await manager.query(
      `INSERT INTO inventory_items ("tenantId", "productId") VALUES ($1, $2)
       ON CONFLICT ("tenantId", "productId") DO NOTHING`,
      [tenantId, productId],
    );
    const [row] = await manager.query<ItemRow[]>(
      `SELECT "avgCost", "inTransitQuantity" FROM inventory_items
        WHERE "tenantId" = $1 AND "productId" = $2 FOR UPDATE`,
      [tenantId, productId],
    );
    return row;
  }

  private async currentQuantity(
    manager: EntityManager,
    warehouseId: string,
    productId: string,
  ): Promise<Decimal> {
    const rows = await manager.query<{ quantity: string }[]>(
      `SELECT "quantity" FROM stock_levels
        WHERE "warehouseId" = $1 AND "productId" = $2`,
      [warehouseId, productId],
    );
    return new Decimal(rows[0]?.quantity ?? 0);
  }

  private async totalQuantity(
    manager: EntityManager,
    tenantId: string,
    productId: string,
  ): Promise<Decimal> {
    const [row] = await manager.query<{ total: string }[]>(
      `SELECT COALESCE(SUM("quantity"), 0) AS "total" FROM stock_levels
        WHERE "tenantId" = $1 AND "productId" = $2`,
      [tenantId, productId],
    );
    return new Decimal(row.total);
  }

  /** الأصناف بمعرّفاتها — كلها يجب أن تكون للشركة ومن نوع "بضاعة مخزنية" */
  async loadStockedProducts(
    productIds: string[],
    tenantId: string,
    manager?: EntityManager,
  ): Promise<Map<string, Product>> {
    const unique = [...new Set(productIds)];
    const found = await this.products.findByIds(unique, tenantId, manager);
    if (found.length !== unique.length) {
      throw new NotFoundException('الصنف غير موجود');
    }
    const service = found.find((p) => p.type !== ProductType.STOCKED);
    if (service) {
      throw new BadRequestException(
        `الصنف "${service.name}" خدمة وليس له مخزون`,
      );
    }
    return new Map(found.map((p) => [p.id, p]));
  }
}

export function assertNoDuplicateProducts(productIds: string[]): void {
  if (new Set(productIds).size !== productIds.length) {
    throw new BadRequestException('لا يمكن تكرار نفس الصنف في المستند');
  }
}

function toStockRow(level: StockLevel, decimals: number): StockRow {
  const avgCost = level.item?.avgCost ?? 0;
  const { quantity } = level;
  const minQuantity = level.minQuantity ?? null;

  let status: StockRow['status'] = 'ok';
  if (quantity < 0) status = 'negative';
  else if (minQuantity !== null && quantity <= minQuantity) status = 'low';

  return {
    warehouseId: level.warehouseId,
    warehouseName: level.warehouse?.name ?? '',
    productId: level.productId,
    productName: level.product?.name ?? '',
    sku: level.product?.sku ?? '',
    unit: level.product?.baseUnit?.name ?? null,
    quantity,
    minQuantity,
    avgCost,
    value: roundMoney(
      new Decimal(Math.max(quantity, 0)).mul(avgCost),
      decimals,
    ),
    status,
  };
}
