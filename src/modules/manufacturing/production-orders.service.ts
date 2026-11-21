// src/modules/manufacturing/production-orders.service.ts
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
import { moneyDecimalsOf, roundMoney } from '../../common/utils/money.util';
import {
  assertWarehouseAllowed,
  assertWarehouseVisible,
  restrictToScopedWarehouses,
} from '../branches/branch-scope';
import { ProductType } from '../catalog/entities/product.entity';
import { StockLotSource } from '../inventory/entities/stock-lot.entity';
import { StockMovementType } from '../inventory/entities/stock-movement.entity';
import { StockService } from '../inventory/stock.service';
import { WarehousesService } from '../inventory/warehouses.service';
import { BomsService } from './boms.service';
import {
  CancelProductionOrderDto,
  CreateProductionOrderDto,
  IssueMaterialsDto,
  ManualTimeLogDto,
  ProductionOrderQueryDto,
  ProductionOutputDto,
  ReturnMaterialsDto,
  StartTimeLogDto,
  StopTimeLogDto,
  UpdateProductionOrderDto,
} from './dto/manufacturing.dto';
import { Bom, BomKind } from './entities/bom.entity';
import { WorkCenter } from './entities/work-center.entity';
import {
  ProductionOrder,
  ProductionOrderByproduct,
  ProductionOrderMaterial,
  ProductionOrderOperation,
  ProductionOrderStatus,
  ProductionTimeLog,
  ProductionTransaction,
  ProductionTransactionType,
  TimeLogKind,
} from './entities/production-order.entity';

const NUMBER_PREFIX = 'MO-';
/** مرجع حركات المخزون وتتبع الدفعات */
export const PRODUCTION_ORDER_REFERENCE = 'production_order';
const SCALE = 4;

const OPEN_STATUSES = [
  ProductionOrderStatus.DRAFT,
  ProductionOrderStatus.RELEASED,
  ProductionOrderStatus.IN_PROGRESS,
];
const ACTIVE_STATUSES = [
  ProductionOrderStatus.RELEASED,
  ProductionOrderStatus.IN_PROGRESS,
];

const STATUS_LABEL: Record<ProductionOrderStatus, string> = {
  [ProductionOrderStatus.DRAFT]: 'مسودة',
  [ProductionOrderStatus.RELEASED]: 'مُطلق',
  [ProductionOrderStatus.IN_PROGRESS]: 'قيد التنفيذ',
  [ProductionOrderStatus.COMPLETED]: 'مكتمل',
  [ProductionOrderStatus.CANCELLED]: 'ملغي',
};

export interface ProductionOrderDetail extends ProductionOrder {
  timeLogs: ProductionTimeLog[];
  transactions: ProductionTransaction[];
  /** التكلفة حتى الآن: الخامات المصروفة + وقت المراكز (مقدّر للجاري) */
  costToDate: {
    material: number;
    labor: number;
    overhead: number;
    total: number;
  };
  /** نسبة الإنجاز % (المستلم الجيد من المخطط) */
  progress: number;
  /** تجاوز تاريخ التسليم ولم يكتمل */
  late: boolean;
}

/**
 * أوامر الإنتاج: التخطيط، الإطلاق (لقطة من القائمة وتكلفة مخططة)، صرف الخامات
 * وردّها بالدفعات، سجل الوقت والتوقف، الاستلام الجزئي والنهائي بالدفعات،
 * والتكلفة الفعلية (خامات + وقت × تكلفة الساعة − المنتجات الثانوية).
 *
 * المخزون يتحرك عبر StockService.apply وحده (بمرجع production_order)، وكل حدث
 * مخزني يُسجَّل حركة إنتاج بقيمته يرحّلها المحرك المحاسبي.
 */
@Injectable()
export class ProductionOrdersService {
  constructor(
    @InjectRepository(ProductionOrder)
    private readonly orders: Repository<ProductionOrder>,
    private readonly boms: BomsService,
    private readonly stock: StockService,
    private readonly warehouses: WarehousesService,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════ القراءة ══════════════════════════

  async findAll(
    tenantId: string,
    query: ProductionOrderQueryDto,
  ): Promise<Paginated<ProductionOrder & { progress: number; late: boolean }>> {
    const { page, limit, skip } = resolvePagination(query);
    const qb = this.orders
      .createQueryBuilder('o')
      .innerJoinAndSelect('o.product', 'product')
      .leftJoinAndSelect('product.baseUnit', 'baseUnit')
      .leftJoinAndSelect('o.warehouse', 'warehouse')
      .where('o.tenantId = :tenantId', { tenantId });
    restrictToScopedWarehouses(qb, 'o.warehouseId');

    if (query.status === 'open') {
      qb.andWhere('o.status IN (:...open)', { open: OPEN_STATUSES });
    } else if (query.status) {
      qb.andWhere('o.status = :status', { status: query.status });
    }
    if (query.productId) {
      qb.andWhere('o.productId = :productId', { productId: query.productId });
    }
    if (query.workCenterId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM production_order_operations op
                  WHERE op."orderId" = o.id AND op."workCenterId" = :wc)`,
        { wc: query.workCenterId },
      );
    }
    if (query.search) {
      qb.andWhere(
        '(o.number ILIKE :s OR o.reference ILIKE :s OR product.name ILIKE :s OR product.sku ILIKE :s)',
        { s: `%${query.search.trim()}%` },
      );
    }
    if (query.from) {
      qb.andWhere('COALESCE(o.plannedStartDate, o.createdAt::date) >= :from', {
        from: query.from,
      });
    }
    if (query.to) {
      qb.andWhere('COALESCE(o.plannedStartDate, o.createdAt::date) <= :to', {
        to: query.to,
      });
    }

    const [data, total] = await qb
      .orderBy('o.priority', 'ASC')
      .addOrderBy('o.plannedStartDate', 'ASC', 'NULLS LAST')
      .addOrderBy('o.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();
    const today = new Date().toISOString().slice(0, 10);
    return paginated(
      data.map((order) => Object.assign(order, derived(order, today))),
      total,
      page,
      limit,
    );
  }

  async findOne(id: string, tenantId: string): Promise<ProductionOrderDetail> {
    const order = await this.orders.findOne({
      where: { id, tenantId },
      relations: [
        'product',
        'product.baseUnit',
        'bom',
        'warehouse',
        'materialsWarehouse',
        'materials',
        'materials.product',
        'materials.product.baseUnit',
        'operations',
        'operations.workCenter',
        'byproducts',
        'byproducts.product',
        'byproducts.product.baseUnit',
      ],
    });
    if (!order) throw new NotFoundException('أمر الإنتاج غير موجود');
    assertWarehouseVisible(order.warehouseId, 'أمر الإنتاج غير موجود');
    order.materials?.sort((a, b) => a.sortOrder - b.sortOrder);
    order.operations?.sort((a, b) => a.sequence - b.sequence);

    const [timeLogs, transactions] = await Promise.all([
      this.dataSource.manager.find(ProductionTimeLog, {
        where: { tenantId, orderId: id },
        order: { startedAt: 'DESC' },
        take: 200,
      }),
      this.dataSource.manager.find(ProductionTransaction, {
        where: { tenantId, orderId: id },
        order: { occurredAt: 'DESC' },
      }),
    ]);
    const costs = operationCosts(order.operations ?? [], false);
    const today = new Date().toISOString().slice(0, 10);
    return Object.assign(order, {
      timeLogs,
      transactions,
      costToDate: {
        material: order.materialCost,
        labor: costs.labor.toDecimalPlaces(3).toNumber(),
        overhead: costs.overhead.toDecimalPlaces(3).toNumber(),
        total: new Decimal(order.materialCost)
          .plus(costs.labor)
          .plus(costs.overhead)
          .toDecimalPlaces(3)
          .toNumber(),
      },
      ...derived(order, today),
    });
  }

  /** لوحة المصنع: الأوامر بحالاتها، المتأخرة، وإنتاج الشهر */
  async summary(tenantId: string): Promise<{
    draft: number;
    released: number;
    inProgress: number;
    late: number;
    completedThisMonth: number;
    producedValueThisMonth: number;
    scrapRateThisMonth: number;
    openOperations: number;
  }> {
    const [row] = await this.dataSource.query<Record<string, string>[]>(
      `SELECT
         COUNT(*) FILTER (WHERE "status" = 'draft') AS "draft",
         COUNT(*) FILTER (WHERE "status" = 'released') AS "released",
         COUNT(*) FILTER (WHERE "status" = 'in_progress') AS "inProgress",
         COUNT(*) FILTER (WHERE "status" IN ('draft','released','in_progress')
                            AND "plannedEndDate" < CURRENT_DATE) AS "late",
         COUNT(*) FILTER (WHERE "status" = 'completed'
                            AND "completedAt" >= date_trunc('month', now())) AS "completedThisMonth",
         COALESCE(SUM("receivedValue" + "byproductValue") FILTER (WHERE "status" = 'completed'
                            AND "completedAt" >= date_trunc('month', now())), 0) AS "producedValue",
         COALESCE(SUM("producedQuantity") FILTER (WHERE "completedAt" >= date_trunc('month', now())), 0) AS "good",
         COALESCE(SUM("scrapQuantity") FILTER (WHERE "completedAt" >= date_trunc('month', now())), 0) AS "scrap"
       FROM production_orders
      WHERE "tenantId" = $1 AND "deletedAt" IS NULL`,
      [tenantId],
    );
    const [ops] = await this.dataSource.query<{ count: string }[]>(
      `SELECT COUNT(*) AS "count" FROM production_order_operations op
         JOIN production_orders o ON o."id" = op."orderId"
        WHERE op."tenantId" = $1 AND op."status" IN ('in_progress','paused')
          AND o."status" IN ('released','in_progress')`,
      [tenantId],
    );
    const good = Number(row.good);
    const scrap = Number(row.scrap);
    return {
      draft: Number(row.draft),
      released: Number(row.released),
      inProgress: Number(row.inProgress),
      late: Number(row.late),
      completedThisMonth: Number(row.completedThisMonth),
      producedValueThisMonth: Number(
        new Decimal(row.producedValue).toDecimalPlaces(3),
      ),
      scrapRateThisMonth:
        good + scrap > 0
          ? Number(((scrap / (good + scrap)) * 100).toFixed(2))
          : 0,
      openOperations: Number(ops.count),
    };
  }

  // ══════════════════════════ المسودة ══════════════════════════

  async create(
    dto: CreateProductionOrderDto,
    tenantId: string,
    userId?: string,
  ): Promise<ProductionOrderDetail> {
    const bom = await this.resolveBom(dto.productId, dto.bomId, tenantId);
    const materialsWarehouseId = dto.materialsWarehouseId ?? dto.warehouseId;
    await this.assertWarehouses(
      [dto.warehouseId, materialsWarehouseId],
      tenantId,
    );
    assertDates(dto.plannedStartDate, dto.plannedEndDate);

    const id = await this.dataSource.transaction(async (manager) => {
      const order = await manager.save(
        manager.create(ProductionOrder, {
          tenantId,
          number: await nextDocumentNumber(
            manager,
            'production_orders',
            NUMBER_PREFIX,
            tenantId,
          ),
          productId: dto.productId,
          bomId: bom.id,
          plannedQuantity: dto.plannedQuantity,
          warehouseId: dto.warehouseId,
          materialsWarehouseId,
          plannedStartDate: dto.plannedStartDate ?? null,
          plannedEndDate: dto.plannedEndDate ?? null,
          priority: dto.priority ?? 3,
          outputLotNumber: dto.outputLotNumber?.trim() || null,
          outputExpiryDate: dto.outputExpiryDate ?? null,
          reference: dto.reference?.trim() || null,
          note: dto.note ?? null,
          createdById: userId ?? null,
        }),
      );
      await this.plan(manager, order, bom, tenantId);
      return order.id;
    });
    return this.findOne(id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateProductionOrderDto,
    tenantId: string,
  ): Promise<ProductionOrderDetail> {
    const current = await this.findOne(id, tenantId);
    assertStatus(current, [ProductionOrderStatus.DRAFT], 'تعديل');
    if (dto.productId && dto.productId !== current.productId) {
      throw new BadRequestException('لا يتغير منتج الأمر — أنشئ أمراً جديداً');
    }
    const bom = await this.resolveBom(
      current.productId,
      dto.bomId ?? current.bomId,
      tenantId,
    );
    const warehouseId = dto.warehouseId ?? current.warehouseId;
    const materialsWarehouseId =
      dto.materialsWarehouseId ?? current.materialsWarehouseId;
    await this.assertWarehouses([warehouseId, materialsWarehouseId], tenantId);
    assertDates(
      dto.plannedStartDate ?? current.plannedStartDate,
      dto.plannedEndDate ?? current.plannedEndDate,
    );

    await this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, id, tenantId);
      assertStatus(order, [ProductionOrderStatus.DRAFT], 'تعديل');
      Object.assign(order, {
        bomId: bom.id,
        warehouseId,
        materialsWarehouseId,
        ...pick(dto, [
          'plannedQuantity',
          'plannedStartDate',
          'plannedEndDate',
          'priority',
          'outputExpiryDate',
        ]),
        ...(dto.outputLotNumber !== undefined
          ? { outputLotNumber: dto.outputLotNumber.trim() || null }
          : {}),
        ...(dto.reference !== undefined
          ? { reference: dto.reference.trim() || null }
          : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      });
      await manager.save(order);
      await this.plan(manager, order, bom, tenantId);
    });
    return this.findOne(id, tenantId);
  }

  /**
   * الإطلاق: لقطة جديدة من القائمة (خامات وخطوات وأسعار مراكز العمل) والتكلفة
   * المخططة بمتوسط التكلفة الآن. بعده لا تُعدَّل الكمية ولا القائمة.
   */
  async release(
    id: string,
    tenantId: string,
    userId?: string,
  ): Promise<ProductionOrderDetail> {
    const current = await this.findOne(id, tenantId);
    assertStatus(current, [ProductionOrderStatus.DRAFT], 'إطلاق');
    const bom = await this.resolveBom(
      current.productId,
      current.bomId,
      tenantId,
    );
    await this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, id, tenantId);
      assertStatus(order, [ProductionOrderStatus.DRAFT], 'إطلاق');
      await this.plan(manager, order, bom, tenantId);

      const materials = await manager.find(ProductionOrderMaterial, {
        where: { orderId: id },
        relations: ['product'],
      });
      const unitCosts = await this.boms.unitCosts(
        materials.map((m) => m.product!),
        tenantId,
        manager,
      );
      const plannedMaterial = materials.reduce(
        (sum, m) =>
          sum.plus(
            new Decimal(m.plannedQuantity).mul(unitCosts.get(m.productId) ?? 0),
          ),
        new Decimal(0),
      );
      const operations = await manager.find(ProductionOrderOperation, {
        where: { orderId: id },
      });
      const planned = operationCosts(operations, true);
      const decimals = await moneyDecimalsOf(manager, tenantId);
      await manager.update(
        ProductionOrder,
        { id, tenantId },
        {
          status: ProductionOrderStatus.RELEASED,
          releasedAt: new Date(),
          releasedById: userId ?? null,
          plannedMaterialCost: roundMoney(plannedMaterial.toNumber(), decimals),
          plannedLaborCost: roundMoney(planned.labor.toNumber(), decimals),
          plannedOverheadCost: roundMoney(
            planned.overhead.toNumber(),
            decimals,
          ),
        },
      );
    });
    return this.findOne(id, tenantId);
  }

  // ══════════════════════════ الخامات ══════════════════════════

  /** صرف خامات للأمر (المتبقي من المخطط إن لم تُذكر أسطر) */
  async issue(
    id: string,
    dto: IssueMaterialsDto,
    tenantId: string,
    userId?: string,
  ): Promise<ProductionOrderDetail> {
    await this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, id, tenantId);
      assertStatus(order, ACTIVE_STATUSES, 'صرف خامات');
      assertWarehouseAllowed(order.materialsWarehouseId);
      const materials = await manager.find(ProductionOrderMaterial, {
        where: { orderId: id },
      });
      const byProduct = new Map(materials.map((m) => [m.productId, m]));

      const lines =
        dto.lines ??
        materials
          .map((m) => ({
            productId: m.productId,
            quantity: new Decimal(m.plannedQuantity)
              .minus(m.issuedQuantity)
              .plus(m.returnedQuantity)
              .toDecimalPlaces(SCALE)
              .toNumber(),
            lotId: undefined as string | undefined,
          }))
          .filter((l) => l.quantity > 0);
      if (!lines.length) {
        throw new BadRequestException('لا خامات متبقية للصرف');
      }

      // مكوّن غير مخطط (بديل أو إضافي) يُضاف للأمر بمخطط صفر
      const extras = lines.filter((l) => !byProduct.has(l.productId));
      if (extras.length) {
        const products = await this.boms.productsOf(
          extras.map((e) => e.productId),
          tenantId,
          manager,
        );
        for (const extra of extras) {
          const product = products.get(extra.productId)!;
          if (product.type !== ProductType.STOCKED) {
            throw new BadRequestException(
              `"${product.name}" ليس صنفاً مخزنياً`,
            );
          }
          const added = await manager.save(
            manager.create(ProductionOrderMaterial, {
              tenantId,
              orderId: id,
              sortOrder: materials.length + 1,
              productId: extra.productId,
              plannedQuantity: 0,
            }),
          );
          byProduct.set(added.productId, added);
        }
      }

      const occurredAt = new Date();
      const results = await this.stock.apply(
        manager,
        tenantId,
        lines.map((line) => ({
          warehouseId: order.materialsWarehouseId,
          productId: line.productId,
          type: StockMovementType.PRODUCTION_ISSUE,
          quantity: -line.quantity,
          note: dto.note
            ? `صرف لأمر إنتاج ${order.number} — ${dto.note}`
            : `صرف لأمر إنتاج ${order.number}`,
          lots: line.lotId
            ? [{ lotId: line.lotId, quantity: line.quantity }]
            : undefined,
        })),
        {
          referenceType: PRODUCTION_ORDER_REFERENCE,
          referenceId: id,
          userId,
          occurredAt,
        },
      );

      let value = new Decimal(0);
      for (const [index, line] of lines.entries()) {
        const material = byProduct.get(line.productId)!;
        const lineValue = new Decimal(line.quantity).mul(
          results[index].unitCost,
        );
        value = value.plus(lineValue);
        await manager.update(
          ProductionOrderMaterial,
          { id: material.id },
          {
            issuedQuantity: new Decimal(material.issuedQuantity)
              .plus(line.quantity)
              .toDecimalPlaces(SCALE)
              .toNumber(),
            cost: new Decimal(material.cost)
              .plus(lineValue)
              .toDecimalPlaces(3)
              .toNumber(),
          },
        );
      }

      await this.recordTransaction(manager, order, {
        type: ProductionTransactionType.ISSUE,
        value,
        warehouseId: order.materialsWarehouseId,
        note: dto.note,
        userId,
        occurredAt,
      });
      await this.markStarted(manager, order, {
        materialCost: new Decimal(order.materialCost).plus(value),
      });
    });
    return this.findOne(id, tenantId);
  }

  /** ردّ خامات لم تُستعمل: بتكلفة صرفها، وإلى دفعاتها */
  async returnMaterials(
    id: string,
    dto: ReturnMaterialsDto,
    tenantId: string,
    userId?: string,
  ): Promise<ProductionOrderDetail> {
    await this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, id, tenantId);
      assertStatus(order, ACTIVE_STATUSES, 'ردّ خامات');
      assertWarehouseAllowed(order.materialsWarehouseId);
      const materials = await manager.find(ProductionOrderMaterial, {
        where: { orderId: id },
        relations: ['product'],
      });
      const byProduct = new Map(materials.map((m) => [m.productId, m]));

      const priced = dto.lines.map((line) => {
        const material = byProduct.get(line.productId);
        if (!material) {
          throw new BadRequestException('صنف لم يُصرف لهذا الأمر');
        }
        const net = new Decimal(material.issuedQuantity).minus(
          material.returnedQuantity,
        );
        if (net.lt(line.quantity)) {
          throw new BadRequestException(
            `المردود من "${material.product?.name}" أكبر من صافي المصروف (${net.toNumber()})`,
          );
        }
        // متوسط تكلفة ما صُرف من هذه الخامة
        const unitCost = net.gt(0)
          ? new Decimal(material.cost).div(net)
          : new Decimal(0);
        return { line, material, unitCost };
      });

      const occurredAt = new Date();
      await this.stock.apply(
        manager,
        tenantId,
        priced.map(({ line, unitCost }) => ({
          warehouseId: order.materialsWarehouseId,
          productId: line.productId,
          type: StockMovementType.PRODUCTION_RETURN,
          quantity: line.quantity,
          unitCost: unitCost.toDecimalPlaces(SCALE).toNumber(),
          note: `ردّ من أمر إنتاج ${order.number}`,
          lotsFrom: {
            referenceType: PRODUCTION_ORDER_REFERENCE,
            referenceId: id,
          },
        })),
        {
          referenceType: PRODUCTION_ORDER_REFERENCE,
          referenceId: id,
          userId,
          occurredAt,
        },
      );

      let value = new Decimal(0);
      for (const { line, material, unitCost } of priced) {
        const lineValue = unitCost.mul(line.quantity);
        value = value.plus(lineValue);
        await manager.update(
          ProductionOrderMaterial,
          { id: material.id },
          {
            returnedQuantity: new Decimal(material.returnedQuantity)
              .plus(line.quantity)
              .toDecimalPlaces(SCALE)
              .toNumber(),
            cost: Decimal.max(new Decimal(material.cost).minus(lineValue), 0)
              .toDecimalPlaces(3)
              .toNumber(),
          },
        );
      }
      await this.recordTransaction(manager, order, {
        type: ProductionTransactionType.RETURN,
        value,
        warehouseId: order.materialsWarehouseId,
        note: dto.note,
        userId,
        occurredAt,
      });
      await manager.update(
        ProductionOrder,
        { id, tenantId },
        {
          materialCost: Decimal.max(
            new Decimal(order.materialCost).minus(value),
            0,
          )
            .toDecimalPlaces(3)
            .toNumber(),
        },
      );
    });
    return this.findOne(id, tenantId);
  }

  // ══════════════════════════ الوقت والتوقف ══════════════════════════

  /** بدء تجهيز أو تشغيل أو توقف على خطوة */
  async startTimeLog(
    id: string,
    dto: StartTimeLogDto,
    tenantId: string,
    userId?: string,
  ): Promise<ProductionOrderDetail> {
    await this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, id, tenantId);
      assertStatus(order, ACTIVE_STATUSES, 'تسجيل وقت');
      const operation = await this.operationOf(manager, order, dto.operationId);
      if (operation.status === 'done') {
        throw new BadRequestException(
          `الخطوة "${operation.name}" منتهية — لا وقت بعدها`,
        );
      }
      const work = dto.kind !== TimeLogKind.DOWNTIME;
      const [open] = await manager.query<{ id: string }[]>(
        `SELECT "id" FROM production_time_logs
          WHERE "operationId" = $1 AND "endedAt" IS NULL
            AND (${work ? `"kind" <> 'downtime'` : `"kind" = 'downtime'`})`,
        [operation.id],
      );
      if (open) {
        throw new BadRequestException(
          work
            ? 'على الخطوة فترة عمل مفتوحة — أوقفها أولاً'
            : 'على الخطوة توقف مفتوح — أنهِه أولاً',
        );
      }
      const now = new Date();
      await manager.save(
        manager.create(ProductionTimeLog, {
          tenantId,
          orderId: id,
          operationId: operation.id,
          workCenterId: operation.workCenterId,
          kind: dto.kind,
          startedAt: now,
          downtimeReason: work ? null : (dto.downtimeReason ?? null),
          employeeId: dto.employeeId ?? null,
          operatorName: dto.operatorName?.trim() || null,
          userId: userId ?? null,
          note: dto.note ?? null,
        }),
      );
      if (work) {
        await manager.update(
          ProductionOrderOperation,
          { id: operation.id },
          {
            status: 'in_progress',
            startedAt: operation.startedAt ?? now,
          },
        );
      }
      await this.markStarted(manager, order);
    });
    return this.findOne(id, tenantId);
  }

  /** إيقاف فترة مفتوحة بما أُنجز فيها */
  async stopTimeLog(
    id: string,
    logId: string,
    dto: StopTimeLogDto,
    tenantId: string,
  ): Promise<ProductionOrderDetail> {
    await this.dataSource.transaction(async (manager) => {
      await this.lock(manager, id, tenantId);
      const log = await manager.findOne(ProductionTimeLog, {
        where: { id: logId, orderId: id, tenantId },
      });
      if (!log) throw new NotFoundException('فترة الوقت غير موجودة');
      if (log.endedAt) throw new BadRequestException('الفترة مغلقة من قبل');
      await this.closeLog(manager, log, new Date(), dto);
    });
    return this.findOne(id, tenantId);
  }

  /** فترة تُسجَّل بعد حدوثها بدقائقها */
  async manualTimeLog(
    id: string,
    dto: ManualTimeLogDto,
    tenantId: string,
    userId?: string,
  ): Promise<ProductionOrderDetail> {
    await this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, id, tenantId);
      assertStatus(order, ACTIVE_STATUSES, 'تسجيل وقت');
      const operation = await this.operationOf(manager, order, dto.operationId);
      const endedAt = new Date();
      const startedAt = dto.startedAt
        ? new Date(dto.startedAt)
        : new Date(endedAt.getTime() - dto.minutes * 60_000);
      if (Number.isNaN(startedAt.getTime()) || startedAt > endedAt) {
        throw new BadRequestException('وقت البداية غير صالح');
      }
      const log = await manager.save(
        manager.create(ProductionTimeLog, {
          tenantId,
          orderId: id,
          operationId: operation.id,
          workCenterId: operation.workCenterId,
          kind: dto.kind,
          startedAt,
          downtimeReason:
            dto.kind === TimeLogKind.DOWNTIME
              ? (dto.downtimeReason ?? null)
              : null,
          employeeId: dto.employeeId ?? null,
          operatorName: dto.operatorName?.trim() || null,
          userId: userId ?? null,
          note: dto.note ?? null,
        }),
      );
      await this.closeLog(
        manager,
        log,
        new Date(startedAt.getTime() + dto.minutes * 60_000),
        dto,
        dto.minutes,
      );
      if (dto.kind !== TimeLogKind.DOWNTIME && operation.status === 'pending') {
        await manager.update(
          ProductionOrderOperation,
          { id: operation.id },
          { status: 'paused', startedAt: operation.startedAt ?? startedAt },
        );
      }
      await this.markStarted(manager, order);
    });
    return this.findOne(id, tenantId);
  }

  /** إنهاء خطوة: تُغلق فتراتها المفتوحة */
  async finishOperation(
    id: string,
    operationId: string,
    tenantId: string,
  ): Promise<ProductionOrderDetail> {
    await this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, id, tenantId);
      assertStatus(order, ACTIVE_STATUSES, 'إنهاء خطوة');
      const operation = await this.operationOf(manager, order, operationId);
      await this.finishOperationIn(manager, operation, new Date());
      await this.markStarted(manager, order);
    });
    return this.findOne(id, tenantId);
  }

  // ══════════════════════════ الاستلام والإكمال ══════════════════════════

  /**
   * استلام ناتج. الجزئي يدخل بتكلفة الوحدة المخططة؛ الأخير (final) يحسب
   * التكلفة الفعلية كاملة (خامات + وقت − منتجات ثانوية) ويُدخل ما بقي منها مع
   * كميته، فيساوي مجموع ما دخل المخزون التكلفة الفعلية بالضبط. إكمال بلا كمية
   * جيدة (دفعة فاشلة) يحمّل التكلفة لفروقات الإنتاج.
   */
  async output(
    id: string,
    dto: ProductionOutputDto,
    tenantId: string,
    userId?: string,
  ): Promise<ProductionOrderDetail> {
    if (!dto.final && !(dto.quantity > 0)) {
      throw new BadRequestException('أدخل الكمية المستلمة');
    }
    await this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, id, tenantId);
      assertStatus(order, ACTIVE_STATUSES, 'استلام إنتاج');
      assertWarehouseAllowed(order.warehouseId);
      const decimals = await moneyDecimalsOf(manager, tenantId);
      const now = new Date();
      const quantity = new Decimal(dto.quantity);

      let value: Decimal;
      let byproductValue = new Decimal(0);
      const updates: Record<string, number | string | Date | null> = {};
      const byproductEntries: {
        productId: string;
        quantity: number;
        unitCost: number;
        rowId: string;
        received: number;
        value: Decimal;
      }[] = [];

      if (!dto.final) {
        value = quantity.mul(estimatedUnitCost(order));
      } else {
        // الوقت المفتوح يُغلق والخطوات تنتهي: الإكمال آخر حدث على الأمر
        const operations = await manager.find(ProductionOrderOperation, {
          where: { orderId: id },
        });
        for (const operation of operations) {
          if (operation.status !== 'done') {
            await this.finishOperationIn(manager, operation, now);
          }
        }
        const finished = await manager.find(ProductionOrderOperation, {
          where: { orderId: id },
        });
        const costs = operationCosts(finished, false, true);

        // المنتجات الثانوية: الفعلي إن أُدخل، وإلا المخطط بنسبة الإنتاج
        const planned = await manager.find(ProductionOrderByproduct, {
          where: { orderId: id },
          relations: ['product'],
        });
        const given = new Map(
          (dto.byproducts ?? []).map((b) => [b.productId, b.quantity]),
        );
        for (const productId of given.keys()) {
          if (!planned.some((p) => p.productId === productId)) {
            throw new BadRequestException('منتج ثانوي ليس على هذا الأمر');
          }
        }
        const totalGood = new Decimal(order.producedQuantity).plus(quantity);
        const ratio = new Decimal(order.plannedQuantity).gt(0)
          ? totalGood.div(order.plannedQuantity)
          : new Decimal(1);
        const unitCosts = await this.boms.unitCosts(
          planned.map((p) => p.product!),
          tenantId,
          manager,
        );
        for (const row of planned) {
          const qty = new Decimal(
            given.get(row.productId) ??
              new Decimal(row.plannedQuantity)
                .mul(ratio)
                .toDecimalPlaces(SCALE),
          );
          if (qty.lte(0)) continue;
          const unitCost = unitCosts.get(row.productId) ?? new Decimal(0);
          const rowValue = qty.mul(unitCost);
          byproductValue = byproductValue.plus(rowValue);
          byproductEntries.push({
            productId: row.productId,
            quantity: qty.toNumber(),
            unitCost: unitCost.toDecimalPlaces(SCALE).toNumber(),
            rowId: row.id,
            received: new Decimal(row.receivedQuantity).plus(qty).toNumber(),
            value: rowValue,
          });
        }

        const total = new Decimal(order.materialCost)
          .plus(costs.labor)
          .plus(costs.overhead)
          .minus(byproductValue);
        const remaining = total.minus(order.receivedValue);
        value = quantity.gt(0) ? Decimal.max(remaining, 0) : new Decimal(0);
        const variance = total.minus(
          new Decimal(order.receivedValue).plus(value),
        );
        const good = new Decimal(order.producedQuantity).plus(quantity);
        Object.assign(updates, {
          laborCost: roundMoney(costs.labor.toNumber(), decimals),
          overheadCost: roundMoney(costs.overhead.toNumber(), decimals),
          byproductValue: roundMoney(byproductValue.toNumber(), decimals),
          varianceValue: roundMoney(variance.toNumber(), decimals),
          unitCost: good.gt(0)
            ? Decimal.max(total, 0).div(good).toDecimalPlaces(SCALE).toNumber()
            : 0,
          status: ProductionOrderStatus.COMPLETED,
          completedAt: now,
          completedById: userId ?? null,
        });
      }

      // ─── المخزون: الناتج بدفعته، ثم المنتجات الثانوية ───
      const entries = [];
      if (quantity.gt(0)) {
        entries.push({
          warehouseId: order.warehouseId,
          productId: order.productId,
          type: StockMovementType.PRODUCTION_OUTPUT,
          quantity: quantity.toNumber(),
          unitCost: value.div(quantity).toDecimalPlaces(SCALE).toNumber(),
          note: `إنتاج أمر ${order.number}`,
          lot: {
            lotNumber:
              dto.lotNumber?.trim() || order.outputLotNumber || order.number,
            expiryDate: dto.expiryDate ?? order.outputExpiryDate ?? null,
            manufactureDate: now.toISOString().slice(0, 10),
            source: StockLotSource.PRODUCTION,
            sourceType: PRODUCTION_ORDER_REFERENCE,
            sourceId: id,
          },
        });
      }
      for (const b of byproductEntries) {
        entries.push({
          warehouseId: order.warehouseId,
          productId: b.productId,
          type: StockMovementType.PRODUCTION_OUTPUT,
          quantity: b.quantity,
          unitCost: b.unitCost,
          note: `منتج ثانوي من أمر ${order.number}`,
          lot: {
            lotNumber: order.outputLotNumber || order.number,
            manufactureDate: now.toISOString().slice(0, 10),
            source: StockLotSource.PRODUCTION,
            sourceType: PRODUCTION_ORDER_REFERENCE,
            sourceId: id,
          },
        });
      }
      if (entries.length) {
        await this.stock.apply(manager, tenantId, entries, {
          referenceType: PRODUCTION_ORDER_REFERENCE,
          referenceId: id,
          userId,
          occurredAt: now,
        });
      }
      for (const b of byproductEntries) {
        await manager.update(
          ProductionOrderByproduct,
          { id: b.rowId },
          {
            receivedQuantity: b.received,
            value: roundMoney(b.value.toNumber(), decimals),
          },
        );
      }

      const transactionValue = value.plus(byproductValue);
      if (
        quantity.gt(0) ||
        transactionValue.gt(0) ||
        (dto.scrapQuantity ?? 0) > 0
      ) {
        await this.recordTransaction(manager, order, {
          type: ProductionTransactionType.OUTPUT,
          value: transactionValue,
          quantity: quantity.toNumber(),
          scrapQuantity: dto.scrapQuantity ?? 0,
          scrapReason: dto.scrapReason ?? null,
          warehouseId: order.warehouseId,
          note: dto.note,
          userId,
          occurredAt: now,
        });
      }

      await this.markStarted(manager, order, {
        producedQuantity: new Decimal(order.producedQuantity).plus(quantity),
        scrapQuantity: new Decimal(order.scrapQuantity).plus(
          dto.scrapQuantity ?? 0,
        ),
        receivedValue: new Decimal(order.receivedValue).plus(value),
        ...updates,
      });
    });
    return this.findOne(id, tenantId);
  }

  /** إلغاء أمر بلا صافي خامات مصروفة ولا ناتج (أعد الخامات أولاً) */
  async cancel(
    id: string,
    dto: CancelProductionOrderDto,
    tenantId: string,
  ): Promise<ProductionOrderDetail> {
    await this.dataSource.transaction(async (manager) => {
      const order = await this.lock(manager, id, tenantId);
      assertStatus(order, OPEN_STATUSES, 'إلغاء');
      if (new Decimal(order.producedQuantity).gt(0)) {
        throw new BadRequestException(
          'استُلم ناتج من الأمر — أكمله بدل إلغائه',
        );
      }
      const [{ net }] = await manager.query<{ net: string | null }[]>(
        `SELECT SUM("issuedQuantity" - "returnedQuantity") AS "net"
           FROM production_order_materials WHERE "orderId" = $1`,
        [id],
      );
      if (new Decimal(net ?? 0).gt(0)) {
        throw new BadRequestException(
          'على الأمر خامات مصروفة — ردّها للمخزن قبل الإلغاء',
        );
      }
      const now = new Date();
      // الوقت المفتوح يُغلق كما هو (يبقى في سجل المركز)
      const open = await manager.find(ProductionTimeLog, {
        where: { orderId: id, tenantId },
      });
      for (const log of open.filter((l) => !l.endedAt)) {
        await this.closeLog(manager, log, now, {});
      }
      await manager.update(
        ProductionOrder,
        { id, tenantId },
        {
          status: ProductionOrderStatus.CANCELLED,
          cancelledAt: now,
          ...(dto.note
            ? {
                note: [order.note, `سبب الإلغاء: ${dto.note}`]
                  .filter(Boolean)
                  .join('\n'),
              }
            : {}),
        },
      );
    });
    return this.findOne(id, tenantId);
  }

  // ══════════════════════════ داخلي ══════════════════════════

  async lock(
    manager: EntityManager,
    id: string,
    tenantId: string,
  ): Promise<ProductionOrder> {
    const order = await manager.findOne(ProductionOrder, {
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!order) throw new NotFoundException('أمر الإنتاج غير موجود');
    assertWarehouseVisible(order.warehouseId, 'أمر الإنتاج غير موجود');
    return order;
  }

  private async resolveBom(
    productId: string,
    bomId: string | undefined,
    tenantId: string,
  ): Promise<Bom> {
    const bom = bomId
      ? await this.boms.findOne(bomId, tenantId)
      : await this.boms.defaultFor(productId, BomKind.PRODUCTION, tenantId);
    if (!bom) {
      throw new BadRequestException(
        'لا قائمة مكوّنات للمنتج — أنشئ قائمة تصنيع له أولاً',
      );
    }
    if (bom.kind !== BomKind.PRODUCTION || bom.productId !== productId) {
      throw new BadRequestException('القائمة ليست قائمة تصنيع لهذا المنتج');
    }
    if (!bom.isActive) {
      throw new BadRequestException('قائمة المكوّنات موقوفة');
    }
    return bom.operations && bom.lines
      ? bom
      : this.boms.findOne(bom.id, tenantId);
  }

  private async assertWarehouses(
    ids: string[],
    tenantId: string,
  ): Promise<void> {
    for (const id of ids) assertWarehouseAllowed(id);
    await this.warehouses.findActiveByIds(ids, tenantId);
  }

  /** الخامات والخطوات والمنتجات الثانوية من القائمة لكمية الأمر */
  private async plan(
    manager: EntityManager,
    order: ProductionOrder,
    bom: Bom,
    tenantId: string,
  ): Promise<void> {
    const full = bom.operations
      ? bom
      : await this.boms.findOne(bom.id, tenantId, manager);
    await manager.delete(ProductionOrderMaterial, { orderId: order.id });
    await manager.delete(ProductionOrderOperation, { orderId: order.id });
    await manager.delete(ProductionOrderByproduct, { orderId: order.id });

    const requirements = this.boms.requirementsOf(full, order.plannedQuantity);
    await manager.save(
      requirements.map((r, index) =>
        manager.create(ProductionOrderMaterial, {
          tenantId,
          orderId: order.id,
          sortOrder: index,
          productId: r.productId,
          plannedQuantity: r.quantity.toNumber(),
          operationSequence: r.operationSequence,
        }),
      ),
    );

    const factor = new Decimal(order.plannedQuantity).div(
      full.outputQuantity || 1,
    );
    const centers = await manager.find(WorkCenter, {
      where: {
        tenantId,
        id: In((full.operations ?? []).map((o) => o.workCenterId)),
      },
    });
    const centerOf = new Map(centers.map((c) => [c.id, c]));
    if (full.operations?.length) {
      await manager.save(
        full.operations.map((op) => {
          const center = centerOf.get(op.workCenterId);
          const efficiency = new Decimal(center?.efficiencyPercent ?? 100).div(
            100,
          );
          return manager.create(ProductionOrderOperation, {
            tenantId,
            orderId: order.id,
            sequence: op.sequence,
            name: op.name,
            workCenterId: op.workCenterId,
            plannedSetupMinutes: op.setupMinutes,
            plannedRunMinutes: new Decimal(op.runMinutes)
              .mul(factor)
              .div(efficiency.gt(0) ? efficiency : 1)
              .toDecimalPlaces(2)
              .toNumber(),
            costPerHour: center?.costPerHour ?? 0,
            overheadPerHour: center?.overheadPerHour ?? 0,
            instructions: op.instructions ?? null,
          });
        }),
      );
    }
    if (full.byproducts?.length) {
      await manager.save(
        full.byproducts.map((b) =>
          manager.create(ProductionOrderByproduct, {
            tenantId,
            orderId: order.id,
            productId: b.productId,
            plannedQuantity: new Decimal(b.quantity)
              .mul(factor)
              .toDecimalPlaces(SCALE)
              .toNumber(),
          }),
        ),
      );
    }
  }

  private async operationOf(
    manager: EntityManager,
    order: ProductionOrder,
    operationId: string,
  ): Promise<ProductionOrderOperation> {
    const operation = await manager.findOne(ProductionOrderOperation, {
      where: { id: operationId, orderId: order.id },
    });
    if (!operation) throw new NotFoundException('الخطوة ليست على هذا الأمر');
    return operation;
  }

  /** يغلق فترة ويضيف دقائقها وما أُنجز فيها على الخطوة */
  private async closeLog(
    manager: EntityManager,
    log: ProductionTimeLog,
    endedAt: Date,
    dto: StopTimeLogDto,
    minutesOverride?: number,
  ): Promise<void> {
    const minutes = new Decimal(
      minutesOverride ??
        Math.max(endedAt.getTime() - log.startedAt.getTime(), 0) / 60_000,
    ).toDecimalPlaces(2);
    await manager.update(
      ProductionTimeLog,
      { id: log.id },
      {
        endedAt,
        minutes: minutes.toNumber(),
        quantity: dto.quantity ?? 0,
        scrapQuantity: dto.scrapQuantity ?? 0,
        scrapReason: dto.scrapReason ?? null,
        ...(dto.note ? { note: dto.note } : {}),
      },
    );
    const operation = await manager.findOneOrFail(ProductionOrderOperation, {
      where: { id: log.operationId },
    });
    const column =
      log.kind === TimeLogKind.SETUP
        ? 'actualSetupMinutes'
        : log.kind === TimeLogKind.RUN
          ? 'actualRunMinutes'
          : 'downtimeMinutes';
    await manager.update(
      ProductionOrderOperation,
      { id: operation.id },
      {
        [column]: new Decimal(operation[column]).plus(minutes).toNumber(),
        quantityDone: new Decimal(operation.quantityDone)
          .plus(dto.quantity ?? 0)
          .toNumber(),
        quantityScrapped: new Decimal(operation.quantityScrapped)
          .plus(dto.scrapQuantity ?? 0)
          .toNumber(),
        ...(log.kind !== TimeLogKind.DOWNTIME &&
        operation.status === 'in_progress'
          ? { status: 'paused' as const }
          : {}),
      },
    );
  }

  private async finishOperationIn(
    manager: EntityManager,
    operation: ProductionOrderOperation,
    at: Date,
  ): Promise<void> {
    const open = await manager.find(ProductionTimeLog, {
      where: { operationId: operation.id },
    });
    for (const log of open.filter((l) => !l.endedAt)) {
      await this.closeLog(manager, log, at, {});
    }
    await manager.update(
      ProductionOrderOperation,
      { id: operation.id },
      {
        status: 'done',
        finishedAt: at,
        startedAt: operation.startedAt ?? at,
      },
    );
  }

  /** أول نشاط فعلي ينقل الأمر "قيد التنفيذ" ويسجّل وقته */
  private async markStarted(
    manager: EntityManager,
    order: ProductionOrder,
    changes: Record<string, Decimal | number | string | Date | null> = {},
  ): Promise<void> {
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
      values[key] =
        value instanceof Decimal
          ? value
              .toDecimalPlaces(key.endsWith('Quantity') ? SCALE : 3)
              .toNumber()
          : value;
    }
    if (order.status === ProductionOrderStatus.RELEASED) {
      values.status ??= ProductionOrderStatus.IN_PROGRESS;
    }
    if (!order.startedAt) values.startedAt = new Date();
    if (Object.keys(values).length) {
      await manager.update(
        ProductionOrder,
        { id: order.id, tenantId: order.tenantId },
        values,
      );
    }
  }

  private async recordTransaction(
    manager: EntityManager,
    order: ProductionOrder,
    input: {
      type: ProductionTransactionType;
      value: Decimal;
      warehouseId: string;
      quantity?: number;
      scrapQuantity?: number;
      scrapReason?: ProductionTransaction['scrapReason'];
      note?: string;
      userId?: string;
      occurredAt: Date;
    },
  ): Promise<void> {
    await manager.save(
      manager.create(ProductionTransaction, {
        tenantId: order.tenantId,
        orderId: order.id,
        type: input.type,
        value: input.value.toDecimalPlaces(3).toNumber(),
        quantity: input.quantity ?? 0,
        scrapQuantity: input.scrapQuantity ?? 0,
        scrapReason: input.scrapReason ?? null,
        warehouseId: input.warehouseId,
        note: input.note ?? null,
        userId: input.userId ?? null,
        occurredAt: input.occurredAt,
      }),
    );
  }
}

/**
 * تكلفة وقت الخطوات. planned = بالمخطط. وإلا بالفعلي (تجهيز + تشغيل؛ التوقف
 * لا يُحمَّل على المنتج)، و`fallbackToPlanned` لخطوة منتهية بلا وقت مسجّل.
 */
export function operationCosts(
  operations: ProductionOrderOperation[],
  planned: boolean,
  fallbackToPlanned = false,
): { labor: Decimal; overhead: Decimal; minutes: Decimal } {
  let labor = new Decimal(0);
  let overhead = new Decimal(0);
  let total = new Decimal(0);
  for (const op of operations) {
    let minutes = planned
      ? new Decimal(op.plannedSetupMinutes).plus(op.plannedRunMinutes)
      : new Decimal(op.actualSetupMinutes).plus(op.actualRunMinutes);
    if (
      !planned &&
      fallbackToPlanned &&
      minutes.isZero() &&
      op.status === 'done'
    ) {
      minutes = new Decimal(op.plannedSetupMinutes).plus(op.plannedRunMinutes);
    }
    const hours = minutes.div(60);
    labor = labor.plus(hours.mul(op.costPerHour));
    overhead = overhead.plus(hours.mul(op.overheadPerHour));
    total = total.plus(minutes);
  }
  return { labor, overhead, minutes: total };
}

/** تكلفة الوحدة المقدّرة للاستلام الجزئي: المخطط، أو الفعلي حتى الآن */
function estimatedUnitCost(order: ProductionOrder): Decimal {
  const planned = new Decimal(order.plannedMaterialCost)
    .plus(order.plannedLaborCost)
    .plus(order.plannedOverheadCost);
  const base = planned.gt(0) ? planned : new Decimal(order.materialCost);
  return new Decimal(order.plannedQuantity).gt(0)
    ? base.div(order.plannedQuantity)
    : new Decimal(0);
}

function derived(
  order: ProductionOrder,
  today: string,
): { progress: number; late: boolean } {
  const planned = Number(order.plannedQuantity) || 0;
  return {
    progress:
      planned > 0
        ? Math.min(
            Number(
              ((Number(order.producedQuantity) / planned) * 100).toFixed(1),
            ),
            100,
          )
        : 0,
    late:
      OPEN_STATUSES.includes(order.status) &&
      !!order.plannedEndDate &&
      order.plannedEndDate < today,
  };
}

function assertStatus(
  order: ProductionOrder,
  allowed: ProductionOrderStatus[],
  action: string,
): void {
  if (!allowed.includes(order.status)) {
    throw new BadRequestException(
      `لا يمكن ${action} أمر حالته "${STATUS_LABEL[order.status]}"`,
    );
  }
}

function assertDates(start?: string | null, end?: string | null): void {
  if (start && end && end < start) {
    throw new BadRequestException('تاريخ التسليم قبل تاريخ البدء');
  }
}

function pick<T extends object, K extends keyof T>(
  source: T,
  keys: K[],
): Partial<Pick<T, K>> {
  const result: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (source[key] !== undefined) result[key] = source[key];
  }
  return result;
}
