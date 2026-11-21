// src/modules/manufacturing/boms.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import { Product, ProductType } from '../catalog/entities/product.entity';
import {
  BomLineDto,
  BomQueryDto,
  CreateBomDto,
  UpdateBomDto,
} from './dto/manufacturing.dto';
import {
  Bom,
  BomByproduct,
  BomKind,
  BomLine,
  BomOperation,
} from './entities/bom.entity';
import { WorkCentersService } from './work-centers.service';

const CODE_PREFIX = 'BOM-';
/** أقصى عمق للقوائم المتداخلة (نصف مصنّع داخل نصف مصنّع، صلصة داخل طبق) */
export const MAX_BOM_DEPTH = 6;

export interface BomCostLine {
  componentId: string;
  name: string;
  sku: string;
  unit: string | null;
  /** لدفعة القائمة، شاملاً الهالك والناتج المتوقع */
  quantity: number;
  unitCost: number;
  cost: number;
  /** نصيب المكوّن من تكلفة الخامات % */
  share: number;
  /** صنف مركّب (وصفة فرعية) حُسبت تكلفته من وصفته */
  isComposite: boolean;
}

export interface BomCost {
  bomId: string;
  outputQuantity: number;
  materials: BomCostLine[];
  materialCost: number;
  operations: {
    sequence: number;
    name: string;
    workCenter: string;
    minutes: number;
    laborCost: number;
    overheadCost: number;
  }[];
  laborCost: number;
  overheadCost: number;
  byproductCredit: number;
  /** للدفعة */
  totalCost: number;
  /** للوحدة الواحدة من الناتج */
  unitCost: number;
  /** للوصفات: سعر البيع قبل الضريبة ونسبة التكلفة منه (food cost %) */
  netSalePrice: number | null;
  costPercent: number | null;
  margin: number | null;
}

/** كمية خامة لازمة لكمية من الناتج */
export interface Requirement {
  productId: string;
  quantity: Decimal;
  operationSequence: number | null;
}

/**
 * قوائم المكوّنات والوصفات: مشتركة بين المصانع (production) والمطاعم (recipe).
 *
 * - المنتج المصنّع (production) صنف مخزني، ومكوّناته مخزنية (النصف مصنّع صنف
 *   مخزني له قائمته). الوصفة (recipe) لصنف مركّب، ومكوّناتها مخزنية أو مركّبة
 *   (وصفة فرعية كالصلصة) تُفك عند البيع.
 * - لكل صنف ونوع قائمة افتراضية واحدة، وإصدارات أخرى للتجربة أو المواسم.
 * - لا دوائر: مكوّن لا يحتوي (ولو بعد مستويات) على المنتج نفسه.
 */
@Injectable()
export class BomsService {
  constructor(
    @InjectRepository(Bom)
    private readonly boms: Repository<Bom>,
    private readonly workCenters: WorkCentersService,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════ القراءة ══════════════════════════

  async findAll(
    tenantId: string,
    query: BomQueryDto,
  ): Promise<Paginated<Bom & { linesCount: number }>> {
    const { page, limit, skip } = resolvePagination(query);
    const qb = this.boms
      .createQueryBuilder('bom')
      .innerJoinAndSelect('bom.product', 'product')
      .leftJoinAndSelect('product.baseUnit', 'baseUnit')
      .loadRelationCountAndMap('bom.linesCount', 'bom.lines')
      .where('bom.tenantId = :tenantId', { tenantId });
    if (query.kind) qb.andWhere('bom.kind = :kind', { kind: query.kind });
    if (query.productId) {
      qb.andWhere('bom.productId = :productId', { productId: query.productId });
    }
    if (query.isActive) {
      qb.andWhere('bom.isActive = :active', {
        active: query.isActive === 'true',
      });
    }
    if (query.search) {
      qb.andWhere(
        '(bom.name ILIKE :s OR bom.code ILIKE :s OR product.name ILIKE :s OR product.sku ILIKE :s)',
        { s: `%${query.search.trim()}%` },
      );
    }
    const [data, total] = await qb
      .orderBy('product.name', 'ASC')
      .addOrderBy('bom.isDefault', 'DESC')
      .addOrderBy('bom.version', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();
    return paginated(
      data as (Bom & { linesCount: number })[],
      total,
      page,
      limit,
    );
  }

  async findOne(
    id: string,
    tenantId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Bom> {
    const bom = await manager.findOne(Bom, {
      where: { id, tenantId },
      relations: [
        'product',
        'product.baseUnit',
        'lines',
        'lines.component',
        'lines.component.baseUnit',
        'operations',
        'operations.workCenter',
        'byproducts',
        'byproducts.product',
        'byproducts.product.baseUnit',
      ],
    });
    if (!bom) throw new NotFoundException('قائمة المكوّنات غير موجودة');
    bom.lines?.sort((a, b) => a.sortOrder - b.sortOrder);
    bom.operations?.sort((a, b) => a.sequence - b.sequence);
    return bom;
  }

  /** القائمة الافتراضية الفعّالة لصنف ونوع (null إن لم توجد) */
  async defaultFor(
    productId: string,
    kind: BomKind,
    tenantId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Bom | null> {
    const bom = await manager.findOne(Bom, {
      where: { tenantId, productId, kind, isDefault: true, isActive: true },
      relations: ['lines', 'operations', 'byproducts'],
    });
    if (bom) bom.lines?.sort((a, b) => a.sortOrder - b.sortOrder);
    return bom;
  }

  /** أين يُستعمل صنف كمكوّن */
  async whereUsed(productId: string, tenantId: string): Promise<Bom[]> {
    return this.boms
      .createQueryBuilder('bom')
      .innerJoinAndSelect('bom.product', 'product')
      .innerJoin('bom.lines', 'line', 'line.componentId = :productId', {
        productId,
      })
      .where('bom.tenantId = :tenantId', { tenantId })
      .orderBy('product.name', 'ASC')
      .getMany();
  }

  // ══════════════════════════ الكتابة ══════════════════════════

  async create(dto: CreateBomDto, tenantId: string): Promise<Bom> {
    const product = await this.validate(dto, tenantId);
    const id = await this.dataSource.transaction(async (manager) => {
      const [{ max }] = await manager.query<{ max: number | null }[]>(
        `SELECT MAX("version") AS "max" FROM boms
          WHERE "tenantId" = $1 AND "productId" = $2 AND "kind" = $3`,
        [tenantId, dto.productId, dto.kind],
      );
      const [{ count }] = await manager.query<{ count: string }[]>(
        `SELECT COUNT(*) AS "count" FROM boms
          WHERE "tenantId" = $1 AND "productId" = $2 AND "kind" = $3
            AND "isDefault" = true AND "deletedAt" IS NULL`,
        [tenantId, dto.productId, dto.kind],
      );
      // أول قائمة للصنف افتراضية دائماً
      const isDefault = Number(count) === 0 ? true : (dto.isDefault ?? false);
      if (isDefault) await this.clearDefault(manager, tenantId, dto);

      const bom = await manager.save(
        manager.create(Bom, {
          tenantId,
          code: await nextDocumentNumber(
            manager,
            'boms',
            CODE_PREFIX,
            tenantId,
            'code',
          ),
          kind: dto.kind,
          productId: dto.productId,
          name: dto.name?.trim() || product.name,
          version: (Number(max) || 0) + 1,
          isDefault,
          outputQuantity: dto.outputQuantity ?? 1,
          expectedYieldPercent: dto.expectedYieldPercent ?? 100,
          prepMinutes: dto.prepMinutes ?? null,
          note: dto.note ?? null,
          isActive: dto.isActive ?? true,
        }),
      );
      await this.replaceChildren(manager, bom.id, tenantId, dto);
      return bom.id;
    });
    return this.findOne(id, tenantId);
  }

  async update(id: string, dto: UpdateBomDto, tenantId: string): Promise<Bom> {
    const current = await this.findOne(id, tenantId);
    if (dto.kind && dto.kind !== current.kind) {
      throw new BadRequestException('لا يتغير نوع القائمة — أنشئ قائمة جديدة');
    }
    if (dto.productId && dto.productId !== current.productId) {
      throw new BadRequestException('لا يتغير منتج القائمة — أنشئ قائمة جديدة');
    }
    const merged: CreateBomDto = {
      kind: current.kind,
      productId: current.productId,
      lines:
        dto.lines ??
        (current.lines ?? []).map((l) => ({
          componentId: l.componentId,
          quantity: l.quantity,
          scrapPercent: l.scrapPercent,
          operationSequence: l.operationSequence ?? null,
          note: l.note ?? undefined,
        })),
      operations:
        dto.operations ??
        (current.operations ?? []).map((o) => ({
          sequence: o.sequence,
          name: o.name,
          workCenterId: o.workCenterId,
          setupMinutes: o.setupMinutes,
          runMinutes: o.runMinutes,
          instructions: o.instructions ?? undefined,
        })),
      byproducts:
        dto.byproducts ??
        (current.byproducts ?? []).map((b) => ({
          productId: b.productId,
          quantity: b.quantity,
        })),
    };
    await this.validate(merged, tenantId);

    await this.dataSource.transaction(async (manager) => {
      if (dto.isDefault === true && !current.isDefault) {
        await this.clearDefault(manager, tenantId, current);
      }
      if (dto.isDefault === false && current.isDefault) {
        throw new BadRequestException(
          'لا بد من قائمة افتراضية — اجعل قائمة أخرى افتراضية بدلها',
        );
      }
      await manager.update(
        Bom,
        { id, tenantId },
        {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.outputQuantity !== undefined
            ? { outputQuantity: dto.outputQuantity }
            : {}),
          ...(dto.expectedYieldPercent !== undefined
            ? { expectedYieldPercent: dto.expectedYieldPercent }
            : {}),
          ...(dto.prepMinutes !== undefined
            ? { prepMinutes: dto.prepMinutes }
            : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      );
      if (dto.lines || dto.operations || dto.byproducts) {
        await this.replaceChildren(manager, id, tenantId, merged);
      }
    });
    return this.findOne(id, tenantId);
  }

  /** نسخة جديدة من القائمة (إصدار تالٍ) غير افتراضية للتعديل والتجربة */
  async duplicate(id: string, tenantId: string): Promise<Bom> {
    const source = await this.findOne(id, tenantId);
    return this.create(
      {
        kind: source.kind,
        productId: source.productId,
        name: `${source.name} (نسخة)`,
        isDefault: false,
        outputQuantity: source.outputQuantity,
        expectedYieldPercent: source.expectedYieldPercent,
        prepMinutes: source.prepMinutes ?? null,
        note: source.note ?? undefined,
        lines: (source.lines ?? []).map((l) => ({
          componentId: l.componentId,
          quantity: l.quantity,
          scrapPercent: l.scrapPercent,
          operationSequence: l.operationSequence ?? null,
          note: l.note ?? undefined,
        })),
        operations: (source.operations ?? []).map((o) => ({
          sequence: o.sequence,
          name: o.name,
          workCenterId: o.workCenterId,
          setupMinutes: o.setupMinutes,
          runMinutes: o.runMinutes,
          instructions: o.instructions ?? undefined,
        })),
        byproducts: (source.byproducts ?? []).map((b) => ({
          productId: b.productId,
          quantity: b.quantity,
        })),
      },
      tenantId,
    );
  }

  /** حذف قائمة لم يُنتج بها؛ المستعملة تُوقف. الافتراضية لا تُحذف وأخرى موجودة */
  async remove(id: string, tenantId: string): Promise<void> {
    const bom = await this.findOne(id, tenantId);
    const [used] = await this.dataSource.query<{ used: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM production_orders WHERE "bomId" = $1) AS "used"`,
      [id],
    );
    if (used?.used) {
      throw new BadRequestException(
        'القائمة عليها أوامر إنتاج — أوقفها بدل حذفها',
      );
    }
    if (bom.isDefault) {
      const [{ others }] = await this.dataSource.query<{ others: string }[]>(
        `SELECT COUNT(*) AS "others" FROM boms
          WHERE "tenantId" = $1 AND "productId" = $2 AND "kind" = $3
            AND "id" <> $4 AND "deletedAt" IS NULL`,
        [tenantId, bom.productId, bom.kind, id],
      );
      if (Number(others) > 0) {
        throw new BadRequestException('اجعل قائمة أخرى افتراضية قبل حذف هذه');
      }
    }
    await this.boms.softDelete({ id, tenantId });
  }

  // ══════════════════════════ التكلفة والتفكيك ══════════════════════════

  /** التكلفة المقدّرة للقائمة بمتوسط تكلفة المكوّنات الآن */
  async cost(id: string, tenantId: string): Promise<BomCost> {
    const bom = await this.findOne(id, tenantId);
    return this.costOf(bom, tenantId);
  }

  async costOf(
    bom: Bom,
    tenantId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<BomCost> {
    const yieldFactor = new Decimal(100).div(bom.expectedYieldPercent || 100);
    const lines = bom.lines ?? [];
    const componentIds = lines.map((l) => l.componentId);
    const products = await this.productsOf(
      [
        ...componentIds,
        ...(bom.byproducts ?? []).map((b) => b.productId),
        bom.productId,
      ],
      tenantId,
      manager,
    );
    const unitCosts = await this.unitCosts(
      [...products.values()],
      tenantId,
      manager,
      0,
    );

    const materials = lines.map((line) => {
      const component = products.get(line.componentId)!;
      const quantity = new Decimal(line.quantity)
        .mul(new Decimal(1).plus(new Decimal(line.scrapPercent).div(100)))
        .mul(yieldFactor);
      const unitCost = unitCosts.get(line.componentId) ?? new Decimal(0);
      return {
        componentId: line.componentId,
        name: component.name,
        sku: component.sku,
        unit: component.baseUnit?.name ?? null,
        quantity,
        unitCost,
        cost: quantity.mul(unitCost),
        isComposite: component.type === ProductType.COMPOSITE,
      };
    });
    const materialCost = materials.reduce(
      (sum, m) => sum.plus(m.cost),
      new Decimal(0),
    );

    const operations = (bom.operations ?? []).map((op) => {
      const minutes = new Decimal(op.setupMinutes).plus(op.runMinutes);
      const hours = minutes.div(60);
      const center = op.workCenter;
      return {
        sequence: op.sequence,
        name: op.name,
        workCenter: center?.name ?? '',
        minutes,
        laborCost: hours.mul(center?.costPerHour ?? 0),
        overheadCost: hours.mul(center?.overheadPerHour ?? 0),
      };
    });
    const laborCost = operations.reduce(
      (sum, o) => sum.plus(o.laborCost),
      new Decimal(0),
    );
    const overheadCost = operations.reduce(
      (sum, o) => sum.plus(o.overheadCost),
      new Decimal(0),
    );
    const byproductCredit = (bom.byproducts ?? []).reduce(
      (sum, b) =>
        sum.plus(new Decimal(b.quantity).mul(unitCosts.get(b.productId) ?? 0)),
      new Decimal(0),
    );
    const totalCost = materialCost
      .plus(laborCost)
      .plus(overheadCost)
      .minus(byproductCredit);
    const unitCost = totalCost.div(bom.outputQuantity || 1);

    // الوصفة: نسبة تكلفة الطبق من سعر بيعه قبل الضريبة
    const product = products.get(bom.productId);
    let netSalePrice: Decimal | null = null;
    if (product && bom.kind === BomKind.RECIPE) {
      const rate = new Decimal(product.taxRate?.rate ?? 0);
      netSalePrice = product.priceIncludesTax
        ? new Decimal(product.salePrice).div(rate.div(100).plus(1))
        : new Decimal(product.salePrice);
    }

    const round = (v: Decimal, places = 3) =>
      v.toDecimalPlaces(places).toNumber();
    return {
      bomId: bom.id,
      outputQuantity: bom.outputQuantity,
      materials: materials.map((m) => ({
        ...m,
        quantity: round(m.quantity, 4),
        unitCost: round(m.unitCost, 4),
        cost: round(m.cost),
        share: materialCost.gt(0)
          ? round(m.cost.div(materialCost).mul(100), 2)
          : 0,
      })),
      materialCost: round(materialCost),
      operations: operations.map((o) => ({
        ...o,
        minutes: round(o.minutes, 2),
        laborCost: round(o.laborCost),
        overheadCost: round(o.overheadCost),
      })),
      laborCost: round(laborCost),
      overheadCost: round(overheadCost),
      byproductCredit: round(byproductCredit),
      totalCost: round(totalCost),
      unitCost: round(unitCost, 4),
      netSalePrice: netSalePrice ? round(netSalePrice) : null,
      costPercent:
        netSalePrice && netSalePrice.gt(0)
          ? round(unitCost.div(netSalePrice).mul(100), 2)
          : null,
      margin: netSalePrice ? round(netSalePrice.minus(unitCost)) : null,
    };
  }

  /**
   * خامات كمية من الناتج بقائمة معيّنة (مستوى واحد)، شاملة الهالك والناتج
   * المتوقع: أساس خامات أمر الإنتاج.
   */
  requirementsOf(bom: Bom, quantity: number | Decimal): Requirement[] {
    const factor = new Decimal(quantity)
      .div(bom.outputQuantity || 1)
      .mul(new Decimal(100).div(bom.expectedYieldPercent || 100));
    return (bom.lines ?? []).map((line) => ({
      productId: line.componentId,
      quantity: new Decimal(line.quantity)
        .mul(factor)
        .mul(new Decimal(1).plus(new Decimal(line.scrapPercent).div(100)))
        .toDecimalPlaces(4),
      operationSequence: line.operationSequence ?? null,
    }));
  }

  /** تكلفة الوحدة الحالية لكل صنف: متوسطه للمخزني، ووصفته للمركّب */
  async unitCosts(
    products: Product[],
    tenantId: string,
    manager: EntityManager = this.dataSource.manager,
    depth = 0,
  ): Promise<Map<string, Decimal>> {
    const result = new Map<string, Decimal>();
    const stocked = products.filter((p) => p.type !== ProductType.COMPOSITE);
    if (stocked.length) {
      const rows = await manager.query<
        { productId: string; avgCost: string; lastCost: string }[]
      >(
        `SELECT "productId", "avgCost", "lastCost" FROM inventory_items
          WHERE "tenantId" = $1 AND "productId" = ANY($2::uuid[])`,
        [tenantId, stocked.map((p) => p.id)],
      );
      for (const row of rows) {
        // بلا متوسط بعد (لم يدخل مخزوناً): آخر تكلفة شراء
        const avg = new Decimal(row.avgCost);
        result.set(row.productId, avg.gt(0) ? avg : new Decimal(row.lastCost));
      }
    }
    if (depth >= MAX_BOM_DEPTH) return result;
    for (const product of products.filter(
      (p) => p.type === ProductType.COMPOSITE,
    )) {
      const recipe = await this.defaultFor(
        product.id,
        BomKind.RECIPE,
        tenantId,
        manager,
      );
      if (!recipe) continue;
      const components = await this.productsOf(
        (recipe.lines ?? []).map((l) => l.componentId),
        tenantId,
        manager,
      );
      const costs = await this.unitCosts(
        [...components.values()],
        tenantId,
        manager,
        depth + 1,
      );
      const total = (recipe.lines ?? []).reduce(
        (sum, line) =>
          sum.plus(
            new Decimal(line.quantity)
              .mul(new Decimal(1).plus(new Decimal(line.scrapPercent).div(100)))
              .mul(costs.get(line.componentId) ?? 0),
          ),
        new Decimal(0),
      );
      result.set(product.id, total.div(recipe.outputQuantity || 1));
    }
    return result;
  }

  // ══════════════════════════ داخلي ══════════════════════════

  private async validate(
    dto: CreateBomDto,
    tenantId: string,
  ): Promise<Product> {
    const ids = [
      dto.productId,
      ...dto.lines.map((l) => l.componentId),
      ...(dto.byproducts ?? []).map((b) => b.productId),
    ];
    const products = await this.productsOf(ids, tenantId);
    const product = products.get(dto.productId);
    if (!product) throw new NotFoundException('المنتج غير موجود');

    if (dto.kind === BomKind.RECIPE && product.type !== ProductType.COMPOSITE) {
      throw new BadRequestException(
        `الوصفة لصنف مركّب فقط — اجعل نوع "${product.name}" صنفاً مركّباً`,
      );
    }
    if (
      dto.kind === BomKind.PRODUCTION &&
      product.type !== ProductType.STOCKED
    ) {
      throw new BadRequestException(
        `المنتج المصنّع "${product.name}" يجب أن يكون صنفاً مخزنياً`,
      );
    }

    const seen = new Set<string>();
    for (const line of dto.lines) {
      const component = products.get(line.componentId);
      if (!component) throw new NotFoundException('مكوّن غير موجود');
      if (line.componentId === dto.productId) {
        throw new BadRequestException('المنتج لا يكون مكوّناً لنفسه');
      }
      if (seen.has(line.componentId)) {
        throw new BadRequestException(
          `المكوّن "${component.name}" مكرر — اجمع كميته في سطر واحد`,
        );
      }
      seen.add(line.componentId);
      const allowed =
        component.type === ProductType.STOCKED ||
        (dto.kind === BomKind.RECIPE &&
          component.type === ProductType.COMPOSITE);
      if (!allowed) {
        throw new BadRequestException(
          dto.kind === BomKind.RECIPE
            ? `المكوّن "${component.name}" خدمة — مكوّنات الوصفة أصناف مخزنية أو مركّبة`
            : `المكوّن "${component.name}" ليس صنفاً مخزنياً`,
        );
      }
    }

    for (const byproduct of dto.byproducts ?? []) {
      const item = products.get(byproduct.productId);
      if (!item) throw new NotFoundException('منتج ثانوي غير موجود');
      if (dto.kind !== BomKind.PRODUCTION) {
        throw new BadRequestException('المنتجات الثانوية للتصنيع فقط');
      }
      if (item.type !== ProductType.STOCKED || item.id === dto.productId) {
        throw new BadRequestException(
          `المنتج الثانوي "${item.name}" يجب أن يكون صنفاً مخزنياً غير المنتج نفسه`,
        );
      }
    }

    if (dto.operations?.length) {
      if (dto.kind !== BomKind.PRODUCTION) {
        throw new BadRequestException('خطوات التصنيع للتصنيع فقط');
      }
      const sequences = dto.operations.map((o) => o.sequence);
      if (new Set(sequences).size !== sequences.length) {
        throw new BadRequestException('رقم الخطوة مكرر');
      }
      await this.workCenters.findActiveByIds(
        dto.operations.map((o) => o.workCenterId),
        tenantId,
      );
      for (const line of dto.lines) {
        if (
          line.operationSequence !== undefined &&
          line.operationSequence !== null &&
          !sequences.includes(line.operationSequence)
        ) {
          throw new BadRequestException(
            `خطوة المكوّن ${line.operationSequence} ليست من خطوات القائمة`,
          );
        }
      }
    }

    await this.assertNoCycle(dto.productId, dto.kind, dto.lines, tenantId);
    return product;
  }

  /** لا مكوّن يحتوي المنتج نفسه ولو بعد مستويات (عبر القوائم الافتراضية) */
  private async assertNoCycle(
    productId: string,
    kind: BomKind,
    lines: BomLineDto[],
    tenantId: string,
  ): Promise<void> {
    let frontier = lines.map((l) => l.componentId);
    const visited = new Set<string>();
    for (let depth = 0; depth < MAX_BOM_DEPTH && frontier.length; depth++) {
      const rows = await this.dataSource.query<
        { productId: string; componentId: string }[]
      >(
        `SELECT b."productId", l."componentId"
           FROM boms b JOIN bom_lines l ON l."bomId" = b."id"
          WHERE b."tenantId" = $1 AND b."kind" = $2 AND b."isDefault" = true
            AND b."deletedAt" IS NULL AND b."productId" = ANY($3::uuid[])`,
        [tenantId, kind, frontier],
      );
      const next: string[] = [];
      for (const row of rows) {
        if (row.componentId === productId) {
          throw new BadRequestException(
            'دائرة في القوائم: أحد المكوّنات يحتوي المنتج نفسه',
          );
        }
        if (!visited.has(row.componentId)) {
          visited.add(row.componentId);
          next.push(row.componentId);
        }
      }
      frontier = next;
    }
  }

  private async clearDefault(
    manager: EntityManager,
    tenantId: string,
    bom: { productId: string; kind: BomKind },
  ): Promise<void> {
    await manager.update(
      Bom,
      { tenantId, productId: bom.productId, kind: bom.kind, isDefault: true },
      { isDefault: false },
    );
  }

  private async replaceChildren(
    manager: EntityManager,
    bomId: string,
    tenantId: string,
    dto: CreateBomDto,
  ): Promise<void> {
    await manager.delete(BomLine, { bomId });
    await manager.delete(BomOperation, { bomId });
    await manager.delete(BomByproduct, { bomId });
    await manager.save(
      dto.lines.map((line, index) =>
        manager.create(BomLine, {
          tenantId,
          bomId,
          sortOrder: index,
          componentId: line.componentId,
          quantity: line.quantity,
          scrapPercent: line.scrapPercent ?? 0,
          operationSequence: line.operationSequence ?? null,
          note: line.note ?? null,
        }),
      ),
    );
    if (dto.operations?.length) {
      await manager.save(
        dto.operations.map((op) =>
          manager.create(BomOperation, {
            tenantId,
            bomId,
            sequence: op.sequence,
            name: op.name.trim(),
            workCenterId: op.workCenterId,
            setupMinutes: op.setupMinutes ?? 0,
            runMinutes: op.runMinutes ?? 0,
            instructions: op.instructions ?? null,
          }),
        ),
      );
    }
    if (dto.byproducts?.length) {
      await manager.save(
        dto.byproducts.map((b) =>
          manager.create(BomByproduct, {
            tenantId,
            bomId,
            productId: b.productId,
            quantity: b.quantity,
          }),
        ),
      );
    }
  }

  async productsOf(
    ids: string[],
    tenantId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Map<string, Product>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const found = await manager.find(Product, {
      where: { tenantId, id: In(unique) },
      relations: ['baseUnit', 'taxRate'],
    });
    if (found.length !== unique.length) {
      throw new NotFoundException('صنف غير موجود');
    }
    return new Map(found.map((p) => [p.id, p]));
  }
}
