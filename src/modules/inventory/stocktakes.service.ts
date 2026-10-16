// src/modules/inventory/stocktakes.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import { ProductType } from '../catalog/entities/product.entity';
import {
  CreateStocktakeDto,
  MAX_LINES,
  StocktakeCountsDto,
  StocktakeLineDto,
  StocktakeQueryDto,
  UpdateStocktakeDto,
} from './dto/inventory.dto';
import { StockMovementType } from './entities/stock-movement.entity';
import {
  Stocktake,
  StocktakeLine,
  StocktakeStatus,
} from './entities/stocktake.entity';
import { assertNoDuplicateProducts, StockService } from './stock.service';
import { WarehousesService } from './warehouses.service';
import {
  assertWarehouseVisible,
  restrictToScopedWarehouses,
} from '../branches/branch-scope';

const REFERENCE_TYPE = 'stocktake';
const NUMBER_PREFIX = 'ST-';
const NOT_FOUND = 'الجرد غير موجود';

/** ما عُدّ في الجرد الآن: تبني عليه شاشة العدّ نسختها على الجهاز */
export interface StocktakeCounts {
  id: string;
  number: string;
  status: StocktakeStatus;
  warehouseId: string;
  warehouseName: string;
  updatedAt: Date;
  lines: {
    productId: string;
    countedQuantity: number;
    countedAt: Date | null;
  }[];
}

/**
 * نتيجة عدّ صنف من شاشة العدّ:
 *   ok     سُجّل (أو أُزيل)
 *   stale  لم يُسجَّل: عند السيرفر عدّ أحدث لنفس الصنف (من جهاز آخر)
 *   error  رُفض (الصنف لم يعد مخزنياً، أو الجرد بلغ حده)
 */
export interface StocktakeCountResult {
  productId: string;
  status: 'ok' | 'stale' | 'error';
  message?: string;
}

/** صنف في نسخة شاشة العدّ للبحث بلا إنترنت (بالاسم أو الكود أو الباركود) */
export interface StocktakeCatalogProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  allowsFractions: boolean;
  isActive: boolean;
  /** factor: كم وحدة أساس يعدّها الباركود (باركود الكرتونة = 24) */
  barcodes: { code: string; factor: number }[];
}

/**
 * الجرد: تُسجَّل الكميات المعدودة في مسودة (لا تغيّر شيئاً)، وعند الاعتماد
 * يُسوّى رصيد كل صنف على ما عُدّ فعلاً بحركة "جرد" تحمل الفرق.
 */
@Injectable()
export class StocktakesService {
  constructor(
    @InjectRepository(Stocktake)
    private readonly stocktakes: Repository<Stocktake>,
    private readonly stock: StockService,
    private readonly warehouses: WarehousesService,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════ القراءة ══════════════════════════

  async findAll(
    tenantId: string,
    query: StocktakeQueryDto,
  ): Promise<Paginated<Stocktake>> {
    const { page, limit, skip } = resolvePagination(query);

    const qb = this.stocktakes
      .createQueryBuilder('stocktake')
      .leftJoinAndSelect('stocktake.warehouse', 'warehouse')
      .loadRelationCountAndMap('stocktake.linesCount', 'stocktake.lines')
      .where('stocktake.tenantId = :tenantId', { tenantId });
    restrictToScopedWarehouses(qb, 'stocktake.warehouseId');

    if (query.status) {
      qb.andWhere('stocktake.status = :status', { status: query.status });
    }
    if (query.warehouseId) {
      qb.andWhere('stocktake.warehouseId = :warehouseId', {
        warehouseId: query.warehouseId,
      });
    }

    const [data, total] = await qb
      .orderBy('stocktake.createdAt', 'DESC')
      .addOrderBy('stocktake.id', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return paginated(data, total, page, limit);
  }

  async findOne(id: string, tenantId: string): Promise<Stocktake> {
    const stocktake = await this.stocktakes.findOne({
      where: { id, tenantId },
      relations: [
        'warehouse',
        'lines',
        'lines.product',
        'lines.product.baseUnit',
      ],
    });
    if (!stocktake) throw new NotFoundException(NOT_FOUND);
    assertWarehouseVisible(stocktake.warehouseId, NOT_FOUND);

    // المسودة تعرض رصيد النظام الحالي بجانب المعدود ليظهر الفرق قبل الاعتماد
    if (stocktake.status === StocktakeStatus.DRAFT && stocktake.lines) {
      const quantities = await this.stock.getQuantities(
        tenantId,
        stocktake.warehouseId,
        stocktake.lines.map((line) => line.productId),
      );
      for (const line of stocktake.lines) {
        line.currentQuantity = quantities.get(line.productId) ?? 0;
      }
    }
    return stocktake;
  }

  // ══════════════════════════ المسودة ══════════════════════════

  async create(
    dto: CreateStocktakeDto,
    tenantId: string,
    userId?: string,
  ): Promise<Stocktake> {
    await this.assertValid(dto.warehouseId, dto.lines, tenantId);

    const id = await this.dataSource.transaction(async (manager) => {
      const stocktake = await manager.save(
        manager.create(Stocktake, {
          tenantId,
          number: await nextDocumentNumber(
            manager,
            'stocktakes',
            NUMBER_PREFIX,
            tenantId,
          ),
          warehouseId: dto.warehouseId,
          note: dto.note ?? null,
          createdById: userId ?? null,
        }),
      );
      await this.replaceLines(
        manager,
        stocktake.id,
        tenantId,
        dto.lines,
        userId,
      );
      return stocktake.id;
    });

    return this.findOne(id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateStocktakeDto,
    tenantId: string,
    userId?: string,
  ): Promise<Stocktake> {
    const current = await this.findOne(id, tenantId);
    assertDraft(current, 'تعديل');

    const warehouseId = dto.warehouseId ?? current.warehouseId;
    await this.assertValid(warehouseId, dto.lines ?? [], tenantId);

    await this.dataSource.transaction(async (manager) => {
      const locked = await this.lock(manager, id, tenantId);
      assertDraft(locked, 'تعديل');
      // الحفظ يستبدل كل الأسطر: لو عُدّ شيء بعد أن فتح المستخدم الجرد
      // (شاشة العدّ، أو مستخدم آخر) يضيع بصمت — نرفض ويعيد الفتح
      if (
        dto.expectedUpdatedAt &&
        locked.updatedAt.getTime() !== new Date(dto.expectedUpdatedAt).getTime()
      ) {
        throw new ConflictException(
          'تغيّر الجرد منذ فتحته (عُدّ من شاشة العدّ أو عدّله غيرك) — أعد فتحه لترى آخر الكميات',
        );
      }

      await manager.update(
        Stocktake,
        { id, tenantId },
        {
          warehouseId,
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
      );
      if (dto.lines) {
        await this.replaceLines(manager, id, tenantId, dto.lines, userId);
      }
    });

    return this.findOne(id, tenantId);
  }

  // ══════════════════════════ شاشة العدّ ══════════════════════════

  /** ما عُدّ في الجرد الآن (خفيف: بلا رصيد النظام، فالعدّ لا يتأثر به) */
  async counts(id: string, tenantId: string): Promise<StocktakeCounts> {
    const stocktake = await this.stocktakes.findOne({
      where: { id, tenantId },
      relations: ['warehouse', 'lines'],
    });
    if (!stocktake) throw new NotFoundException(NOT_FOUND);
    assertWarehouseVisible(stocktake.warehouseId, NOT_FOUND);
    return {
      id: stocktake.id,
      number: stocktake.number,
      status: stocktake.status,
      warehouseId: stocktake.warehouseId,
      warehouseName: stocktake.warehouse?.name ?? '',
      updatedAt: stocktake.updatedAt,
      lines: (stocktake.lines ?? []).map((line) => ({
        productId: line.productId,
        countedQuantity: line.countedQuantity,
        countedAt: line.countedAt ?? null,
      })),
    };
  }

  /**
   * عدّ من شاشة العدّ — ربما بلا إنترنت ومن أكثر من جهاز. كل عدّ **يضع** كمية
   * الصنف (لا يضيف عليها)، فإعادة رفعه لا تكررها. عدّان لنفس الصنف: الأحدث
   * بوقت الجهاز يكسب ولو وصل أولاً، والأقدم يعود `stale`. `null` يزيل الصنف،
   * إلا إن كان عند السيرفر عدّ أحدث منه.
   *
   * صنف لم يعد مخزنياً يُرفض وحده ولا يوقف باقي العدّ. يعيد ما عُدّ بعدها
   * لتحدّث الشاشة نسختها (وفيه عدّ الأجهزة الأخرى).
   */
  async applyCounts(
    id: string,
    dto: StocktakeCountsDto,
    tenantId: string,
    userId?: string,
  ): Promise<{ results: StocktakeCountResult[]; stocktake: StocktakeCounts }> {
    const results: StocktakeCountResult[] = [];

    await this.dataSource.transaction(async (manager) => {
      const stocktake = await this.lock(manager, id, tenantId);
      assertWarehouseVisible(stocktake.warehouseId, NOT_FOUND);
      assertDraft(stocktake, 'تعديل');

      const lines = new Map(
        (await manager.find(StocktakeLine, { where: { stocktakeId: id } })).map(
          (line) => [line.productId, line],
        ),
      );
      const countable = await this.countableProductIds(
        manager,
        tenantId,
        dto.counts
          .filter((count) => count.countedQuantity !== null)
          .map((count) => count.productId),
      );

      const now = new Date();
      for (const count of dto.counts) {
        const { productId } = count;
        const countedAt = notAfter(new Date(count.countedAt), now);
        const line = lines.get(productId);
        // سطر قديم بلا وقت عدّ: أي عدّ جديد يغلبه
        const newer = !line?.countedAt || line.countedAt <= countedAt;

        if (line && !newer) {
          results.push({ productId, status: 'stale' });
          continue;
        }

        if (count.countedQuantity === null) {
          if (line) {
            await manager.delete(StocktakeLine, { id: line.id });
            lines.delete(productId);
          }
          results.push({ productId, status: 'ok' });
          continue;
        }

        if (!countable.has(productId)) {
          results.push({
            productId,
            status: 'error',
            message: 'الصنف حُذف أو لم يعد صنفاً مخزنياً',
          });
          continue;
        }

        const values = {
          countedQuantity: count.countedQuantity,
          countedAt,
          countedById: userId ?? null,
        };
        if (line) {
          await manager.update(StocktakeLine, { id: line.id }, values);
          Object.assign(line, values);
        } else if (lines.size >= MAX_LINES) {
          results.push({
            productId,
            status: 'error',
            message: `بلغ الجرد حده (${MAX_LINES} صنف) — اعتمده وابدأ جرداً آخر للباقي`,
          });
          continue;
        } else {
          lines.set(
            productId,
            await manager.save(
              manager.create(StocktakeLine, {
                stocktakeId: id,
                tenantId,
                productId,
                ...values,
              }),
            ),
          );
        }
        results.push({ productId, status: 'ok' });
      }

      // لوحة التحكم تعرف أن الجرد تغيّر (حفظها القديم يُرفض بدل أن يمسح هذا)
      await manager.update(Stocktake, { id, tenantId }, { updatedAt: now });
    });

    return { results, stocktake: await this.counts(id, tenantId) };
  }

  /**
   * أصناف الشركة المخزنية لنسخة شاشة العدّ: تبحث فيها بلا إنترنت بالاسم أو
   * الكود أو الباركود. الموقوف منها معها (قد يبقى له رصيد يُعدّ).
   */
  async catalog(
    id: string,
    tenantId: string,
  ): Promise<{ products: StocktakeCatalogProduct[] }> {
    const stocktake = await this.stocktakes.findOne({
      where: { id, tenantId },
    });
    if (!stocktake) throw new NotFoundException(NOT_FOUND);
    assertWarehouseVisible(stocktake.warehouseId, NOT_FOUND);

    const [products, barcodes] = await Promise.all([
      this.dataSource.query<
        {
          id: string;
          name: string;
          sku: string;
          unit: string;
          allowsFractions: boolean;
          isActive: boolean;
        }[]
      >(
        `SELECT p."id", p."name", p."sku", p."isActive",
                u."name" AS "unit", u."allowsFractions"
           FROM products p
           JOIN units u ON u."id" = p."baseUnitId"
          WHERE p."tenantId" = $1 AND p."type" = $2 AND p."deletedAt" IS NULL
          ORDER BY p."name"`,
        [tenantId, ProductType.STOCKED],
      ),
      this.dataSource.query<
        { productId: string; code: string; factor: string | null }[]
      >(
        `SELECT b."productId", b."barcode" AS "code", pu."factor"
           FROM product_barcodes b
           LEFT JOIN product_units pu
             ON pu."productId" = b."productId" AND pu."unitId" = b."unitId"
          WHERE b."tenantId" = $1`,
        [tenantId],
      ),
    ]);

    const barcodesOf = new Map<string, StocktakeCatalogProduct['barcodes']>();
    for (const row of barcodes) {
      const list = barcodesOf.get(row.productId) ?? [];
      // باركود وحدة الأساس (أو وحدة لم تعد على الصنف): قطعة واحدة
      list.push({ code: row.code, factor: Number(row.factor ?? 1) || 1 });
      barcodesOf.set(row.productId, list);
    }
    return {
      products: products.map((product) => ({
        ...product,
        barcodes: barcodesOf.get(product.id) ?? [],
      })),
    };
  }

  // ══════════════════════════ الاعتماد والإلغاء ══════════════════════════

  /** اعتماد الجرد: تسوية رصيد كل صنف على الكمية المعدودة */
  async post(
    id: string,
    tenantId: string,
    userId?: string,
  ): Promise<Stocktake> {
    await this.dataSource.transaction(async (manager) => {
      const stocktake = await this.lock(manager, id, tenantId);
      assertDraft(stocktake, 'اعتماد');
      const lines = await manager.find(StocktakeLine, {
        where: { stocktakeId: id },
      });
      // الجرد يبدأ فارغاً ويُملأ من شاشة العدّ: لا اعتماد قبل أن يُعدّ شيء
      if (!lines.length) {
        throw new BadRequestException(
          'لم يُعدّ أي صنف في هذا الجرد بعد — أضف الأصناف أو ارفع العدّ أولاً',
        );
      }

      // targetQuantity: الفرق يُحسب داخل قفل الصنف، فبيع يتم أثناء الاعتماد
      // لا يفسد النتيجة
      const results = await this.stock.apply(
        manager,
        tenantId,
        lines.map((line) => ({
          warehouseId: stocktake.warehouseId,
          productId: line.productId,
          type: StockMovementType.STOCKTAKE,
          targetQuantity: line.countedQuantity,
          note: `جرد ${stocktake.number}`,
        })),
        { referenceType: REFERENCE_TYPE, referenceId: id, userId },
      );

      for (const [index, line] of lines.entries()) {
        await manager.update(
          StocktakeLine,
          { id: line.id },
          {
            expectedQuantity: results[index].previousQuantity,
            unitCost: results[index].unitCost,
          },
        );
      }

      await manager.update(
        Stocktake,
        { id, tenantId },
        {
          status: StocktakeStatus.POSTED,
          postedAt: new Date(),
          postedById: userId ?? null,
        },
      );
    });

    return this.findOne(id, tenantId);
  }

  async cancel(id: string, tenantId: string): Promise<Stocktake> {
    await this.dataSource.transaction(async (manager) => {
      assertDraft(await this.lock(manager, id, tenantId), 'إلغاء');
      await manager.update(
        Stocktake,
        { id, tenantId },
        { status: StocktakeStatus.CANCELLED },
      );
    });

    return this.findOne(id, tenantId);
  }

  // ══════════════════════════ داخلي ══════════════════════════

  private async assertValid(
    warehouseId: string,
    lines: StocktakeLineDto[],
    tenantId: string,
  ): Promise<void> {
    await this.warehouses.findActiveByIds([warehouseId], tenantId);

    const productIds = lines.map((l) => l.productId);
    assertNoDuplicateProducts(productIds);
    await this.stock.loadStockedProducts(productIds, tenantId);
  }

  private async lock(
    manager: EntityManager,
    id: string,
    tenantId: string,
  ): Promise<Stocktake> {
    const stocktake = await manager.findOne(Stocktake, {
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!stocktake) throw new NotFoundException(NOT_FOUND);
    return stocktake;
  }

  /** مخزنية وغير محذوفة: يجوز عدّها (الموقوف قد يبقى له رصيد) */
  private async countableProductIds(
    manager: EntityManager,
    tenantId: string,
    productIds: string[],
  ): Promise<Set<string>> {
    if (!productIds.length) return new Set();
    const rows = await manager.query<{ id: string }[]>(
      `SELECT "id" FROM products
        WHERE "tenantId" = $1 AND "id" = ANY($2::uuid[])
          AND "type" = $3 AND "deletedAt" IS NULL`,
      [tenantId, [...new Set(productIds)], ProductType.STOCKED],
    );
    return new Set(rows.map((row) => row.id));
  }

  /**
   * يستبدل أسطر المسودة (حفظ من لوحة التحكم). الصنف الذي لم تتغير كميته يحتفظ
   * بوقت عدّه ومن عدّه، فعدّ أقدم يصل بعدها من شاشة العدّ لا يغلبه خطأً.
   */
  private async replaceLines(
    manager: EntityManager,
    stocktakeId: string,
    tenantId: string,
    lines: StocktakeLineDto[],
    userId?: string,
  ): Promise<void> {
    const previous = new Map(
      (await manager.find(StocktakeLine, { where: { stocktakeId } })).map(
        (line) => [line.productId, line],
      ),
    );
    const now = new Date();
    await manager.delete(StocktakeLine, { stocktakeId, tenantId });
    await manager.save(
      lines.map((line) => {
        const before = previous.get(line.productId);
        const unchanged =
          before && Number(before.countedQuantity) === line.countedQuantity;
        return manager.create(StocktakeLine, {
          stocktakeId,
          tenantId,
          productId: line.productId,
          countedQuantity: line.countedQuantity,
          countedAt: unchanged ? (before.countedAt ?? null) : now,
          countedById: unchanged
            ? (before.countedById ?? null)
            : (userId ?? null),
        });
      }),
    );
  }
}

/** وقت من الجهاز: ساعته قد تكون متقدمة، فلا يتجاوز الآن */
function notAfter(at: Date, now: Date): Date {
  return Number.isNaN(at.getTime()) || at > now ? now : at;
}

const STATUS_LABEL: Record<StocktakeStatus, string> = {
  [StocktakeStatus.DRAFT]: 'مسودة',
  [StocktakeStatus.POSTED]: 'معتمد',
  [StocktakeStatus.CANCELLED]: 'ملغي',
};

function assertDraft(stocktake: Stocktake, action: string): void {
  if (stocktake.status !== StocktakeStatus.DRAFT) {
    throw new BadRequestException(
      `لا يمكن ${action} جرد حالته "${STATUS_LABEL[stocktake.status]}"`,
    );
  }
}
