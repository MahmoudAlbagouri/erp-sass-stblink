// src/modules/delivery/delivery.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, In, IsNull, Repository } from 'typeorm';
import {
  Paginated,
  paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { nextDocumentNumber } from '../../common/utils/document-number.util';
import { sumMoney } from '../../common/utils/document-totals.util';
import { moneyDecimalsOf, roundMoney } from '../../common/utils/money.util';
import {
  startOfDayInZone,
  tenantTimezoneOf,
} from '../../common/utils/timezone.util';
import {
  assertWarehouseAllowed,
  assertWarehouseVisible,
  restrictToScopedWarehouses,
  scopedWarehouseIds,
} from '../branches/branch-scope';
import { Product, ProductType } from '../catalog/entities/product.entity';
import { Unit } from '../catalog/entities/unit.entity';
import { CatalogSettingsService } from '../catalog/catalog-settings.service';
import { ProductsService } from '../catalog/products.service';
import { SalesPaymentMethod } from '../sales/entities/customer-payment.entity';
import { SalesInvoice } from '../sales/entities/sales-invoice.entity';
import { SalesInvoicesService } from '../sales/sales-invoices.service';
import { SalesReturnsService } from '../sales/sales-returns.service';
import { dateOnly } from '../sales/utils/payment-recorder';
import {
  AssignDeliveryOrderDto,
  CreateDeliveryAgentDto,
  CreateDeliveryOrderDto,
  CreateDeliverySettlementDto,
  CreateDeliveryZoneDto,
  DELIVERY_STATUSES,
  DeliveryAgentQueryDto,
  DeliveryOrderQueryDto,
  DeliverySettlementQueryDto,
  FailDeliveryOrderDto,
  UpdateDeliveryAgentDto,
  UpdateDeliveryZoneDto,
} from './dto/delivery.dto';
import {
  DeliveryAgent,
  DeliveryOrder,
  DeliveryOrderStatus,
  DeliveryPaymentMode,
  DeliverySettlement,
  DeliveryZone,
} from './entities/delivery.entity';

const ORDER_PREFIX = 'DLV-';
const SETTLEMENT_PREFIX = 'DST-';
/** صنف الخدمة الذي تُفوتر به رسوم التوصيل على العميل */
export const DELIVERY_FEE_SKU = 'DELIVERY-FEE';
const DELIVERY_FEE_NAME = 'رسوم التوصيل';
const SERVICE_UNIT_NAME = 'قطعة';

const ORDER_NOT_FOUND = 'أوردر التوصيل غير موجود';

/** الحالات التي يُعتبر فيها الأوردر "مفتوحاً" (لم ينتهِ) */
const OPEN_STATUSES = [
  DeliveryOrderStatus.NEW,
  DeliveryOrderStatus.ASSIGNED,
  DeliveryOrderStatus.OUT,
];
/** الحالات المنتهية التي تدخل التسوية */
const FINISHED_STATUSES = [
  DeliveryOrderStatus.DELIVERED,
  DeliveryOrderStatus.FAILED,
];

const STATUS_LABEL: Record<DeliveryOrderStatus, string> = {
  [DeliveryOrderStatus.NEW]: 'جديد',
  [DeliveryOrderStatus.ASSIGNED]: 'مُسند',
  [DeliveryOrderStatus.OUT]: 'خرج للتوصيل',
  [DeliveryOrderStatus.DELIVERED]: 'تم التسليم',
  [DeliveryOrderStatus.FAILED]: 'لم يُسلَّم',
  [DeliveryOrderStatus.CANCELLED]: 'ملغي',
};

export interface DeliverySummary {
  /** عدد الأوردرات في كل حالة (المنتهية: اليوم فقط) */
  counts: Record<DeliveryOrderStatus, number>;
  /** أوردرات في الطريق تجاوزت الوقت المتوقع لمنطقتها */
  lateCount: number;
  /** مال المحل مع جهات التوصيل (مُسلَّم بالتحصيل ولم يُسوَّ) */
  heldTotal: number;
  /** مبالغ تحصيل أوردرات في الطريق (ستُحصَّل عند التسليم) */
  outCodTotal: number;
}

/**
 * التوصيل والشحن: أوردرات تخرج مع طيار المحل أو شركة شحن.
 *
 * الأوردر غلاف حول فاتورة بيع: يُنشئها مسودة، يصدرها عند خروجه (فتخرج
 * البضاعة من المخزن ويُسجَّل الدفع: "courier" للتحصيل عند الاستلام، أو طريقة
 * الدفع المقدّم)، ويُرجعها كاملة إن لم يُسلَّم. كل انتقال حالة يقع في معاملة
 * واحدة مع أثره على الفاتورة، وبشرط الحالة السابقة: ضغطتان متزامنتان لا
 * تُخرجان الأوردر مرتين.
 */
@Injectable()
export class DeliveryService {
  constructor(
    @InjectRepository(DeliveryAgent)
    private readonly agents: Repository<DeliveryAgent>,
    @InjectRepository(DeliveryZone)
    private readonly zones: Repository<DeliveryZone>,
    @InjectRepository(DeliveryOrder)
    private readonly orders: Repository<DeliveryOrder>,
    @InjectRepository(DeliverySettlement)
    private readonly settlements: Repository<DeliverySettlement>,
    private readonly invoices: SalesInvoicesService,
    private readonly returns: SalesReturnsService,
    private readonly products: ProductsService,
    private readonly catalogSettings: CatalogSettingsService,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════ جهات التوصيل ══════════════════════════

  /** الطيارون وشركات الشحن، ومع كل جهة ما معها الآن من أوردرات ومال */
  async findAgents(
    tenantId: string,
    query: DeliveryAgentQueryDto = {},
  ): Promise<DeliveryAgent[]> {
    const agents = await this.agents.find({
      where: {
        tenantId,
        ...(query.type ? { type: query.type } : {}),
        ...(query.active === 'true' ? { isActive: true } : {}),
      },
      order: { isActive: 'DESC', name: 'ASC' },
    });

    const stats = await this.agentStats(tenantId);
    for (const agent of agents) {
      const row = stats.get(agent.id);
      agent.heldAmount = row?.held ?? 0;
      agent.outCount = row?.out ?? 0;
      agent.unsettledCount = row?.unsettled ?? 0;
    }
    return agents;
  }

  async findAgent(id: string, tenantId: string): Promise<DeliveryAgent> {
    const agent = await this.agents.findOne({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('جهة التوصيل غير موجودة');
    const row = (await this.agentStats(tenantId, id)).get(id);
    agent.heldAmount = row?.held ?? 0;
    agent.outCount = row?.out ?? 0;
    agent.unsettledCount = row?.unsettled ?? 0;
    return agent;
  }

  async createAgent(
    dto: CreateDeliveryAgentDto,
    tenantId: string,
  ): Promise<DeliveryAgent> {
    const name = dto.name.trim();
    await this.assertAgentNameFree(name, tenantId);
    const agent = await this.agents.save(
      this.agents.create({
        tenantId,
        type: dto.type,
        name,
        phone: dto.phone?.trim() || null,
        defaultFee: dto.defaultFee ?? 0,
        codFeePercent: dto.codFeePercent ?? 0,
        isActive: dto.isActive ?? true,
        note: dto.note ?? null,
      }),
    );
    return this.findAgent(agent.id, tenantId);
  }

  async updateAgent(
    id: string,
    dto: UpdateDeliveryAgentDto,
    tenantId: string,
  ): Promise<DeliveryAgent> {
    const agent = await this.findAgent(id, tenantId);
    const changes: Partial<DeliveryAgent> = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name !== agent.name) await this.assertAgentNameFree(name, tenantId);
      changes.name = name;
    }
    if (dto.type !== undefined) changes.type = dto.type;
    if (dto.phone !== undefined) changes.phone = dto.phone?.trim() || null;
    if (dto.defaultFee !== undefined) changes.defaultFee = dto.defaultFee;
    if (dto.codFeePercent !== undefined) {
      changes.codFeePercent = dto.codFeePercent;
    }
    if (dto.isActive !== undefined) changes.isActive = dto.isActive;
    if (dto.note !== undefined) changes.note = dto.note;

    if (Object.keys(changes).length) {
      await this.agents.update({ id, tenantId }, changes);
    }
    return this.findAgent(id, tenantId);
  }

  /** حذف جهة لا شيء معلّق عليها (لا أوردرات مفتوحة ولا غير مسوّاة) */
  async removeAgent(id: string, tenantId: string): Promise<void> {
    const agent = await this.findAgent(id, tenantId);
    const pending = await this.orders.count({
      where: [
        { tenantId, agentId: id, status: In(OPEN_STATUSES) },
        {
          tenantId,
          agentId: id,
          status: In(FINISHED_STATUSES),
          settlementId: IsNull(),
        },
      ],
    });
    if (pending > 0) {
      throw new BadRequestException(
        `لا يمكن حذف "${agent.name}": عليه ${pending} أوردر لم ينتهِ أو لم يُسوَّ — سوِّه أولاً أو أوقفه بدل الحذف`,
      );
    }
    await this.agents.softDelete({ id, tenantId });
  }

  private async assertAgentNameFree(
    name: string,
    tenantId: string,
  ): Promise<void> {
    const exists = await this.agents.exists({ where: { tenantId, name } });
    if (exists) {
      throw new ConflictException(`يوجد طيار أو شركة شحن بالاسم "${name}"`);
    }
  }

  /** لكل جهة: أوردرات في الطريق، منتهية غير مسوّاة، والمحصَّل معها */
  private async agentStats(
    tenantId: string,
    agentId?: string,
  ): Promise<Map<string, { out: number; unsettled: number; held: number }>> {
    const params: unknown[] = [tenantId];
    let filter = '';
    if (agentId) {
      params.push(agentId);
      filter += ` AND "agentId" = $${params.length}`;
    }
    const scoped = scopedWarehouseIds();
    if (scoped) {
      params.push(scoped);
      filter += ` AND "warehouseId" = ANY($${params.length}::uuid[])`;
    }

    const rows = await this.dataSource.query<
      { agentId: string; out: string; unsettled: string; held: string }[]
    >(
      `SELECT "agentId",
              COUNT(*) FILTER (WHERE "status" = 'out_for_delivery') AS "out",
              COUNT(*) FILTER (WHERE "status" IN ('delivered', 'failed')
                                 AND "settlementId" IS NULL) AS "unsettled",
              COALESCE(SUM("codAmount") FILTER (WHERE "status" = 'delivered'
                                 AND "settlementId" IS NULL), 0) AS "held"
         FROM "delivery_orders"
        WHERE "tenantId" = $1 AND "agentId" IS NOT NULL
          AND "deletedAt" IS NULL${filter}
        GROUP BY "agentId"`,
      params,
    );
    return new Map(
      rows.map((row) => [
        row.agentId,
        {
          out: Number(row.out),
          unsettled: Number(row.unsettled),
          held: Number(row.held),
        },
      ]),
    );
  }

  // ══════════════════════════ المناطق ══════════════════════════

  findZones(tenantId: string): Promise<DeliveryZone[]> {
    return this.zones.find({
      where: { tenantId },
      order: { isActive: 'DESC', name: 'ASC' },
    });
  }

  async findZone(id: string, tenantId: string): Promise<DeliveryZone> {
    const zone = await this.zones.findOne({ where: { id, tenantId } });
    if (!zone) throw new NotFoundException('منطقة التوصيل غير موجودة');
    return zone;
  }

  async createZone(
    dto: CreateDeliveryZoneDto,
    tenantId: string,
  ): Promise<DeliveryZone> {
    const name = dto.name.trim();
    await this.assertZoneNameFree(name, tenantId);
    return this.zones.save(
      this.zones.create({
        tenantId,
        name,
        fee: dto.fee,
        estimatedMinutes: dto.estimatedMinutes ?? null,
        isActive: dto.isActive ?? true,
      }),
    );
  }

  async updateZone(
    id: string,
    dto: UpdateDeliveryZoneDto,
    tenantId: string,
  ): Promise<DeliveryZone> {
    const zone = await this.findZone(id, tenantId);
    const changes: Partial<DeliveryZone> = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name !== zone.name) await this.assertZoneNameFree(name, tenantId);
      changes.name = name;
    }
    if (dto.fee !== undefined) changes.fee = dto.fee;
    if (dto.estimatedMinutes !== undefined) {
      changes.estimatedMinutes = dto.estimatedMinutes;
    }
    if (dto.isActive !== undefined) changes.isActive = dto.isActive;
    if (Object.keys(changes).length) {
      await this.zones.update({ id, tenantId }, changes);
    }
    return this.findZone(id, tenantId);
  }

  /** الأوردرات القديمة تحتفظ باسم منطقتها (الحذف ناعم) */
  async removeZone(id: string, tenantId: string): Promise<void> {
    await this.findZone(id, tenantId);
    await this.zones.softDelete({ id, tenantId });
  }

  private async assertZoneNameFree(
    name: string,
    tenantId: string,
  ): Promise<void> {
    if (await this.zones.exists({ where: { tenantId, name } })) {
      throw new ConflictException(`توجد منطقة توصيل بالاسم "${name}"`);
    }
  }

  // ══════════════════════════ الأوردرات ══════════════════════════

  async findOrders(
    tenantId: string,
    query: DeliveryOrderQueryDto,
  ): Promise<Paginated<DeliveryOrder>> {
    const { page, limit, skip } = resolvePagination(query);
    const qb = this.orderQuery(tenantId);

    if (query.status) {
      const statuses = query.status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const invalid = statuses.find(
        (s) => !DELIVERY_STATUSES.includes(s as DeliveryOrderStatus),
      );
      if (invalid) throw new BadRequestException(`حالة غير معروفة: ${invalid}`);
      if (statuses.length) {
        qb.andWhere('o.status IN (:...statuses)', { statuses });
      }
    }
    if (query.agentId) {
      qb.andWhere('o.agentId = :agentId', { agentId: query.agentId });
    }
    if (query.unsettled === 'true') {
      qb.andWhere('o.status IN (:...finished)', {
        finished: FINISHED_STATUSES,
      }).andWhere('o.settlementId IS NULL');
    }
    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        `(o.number ILIKE :like OR o.recipientName ILIKE :like OR o.phone ILIKE :like
          OR o.trackingNumber ILIKE :like OR invoice.number ILIKE :like)`,
        { like: `%${search}%` },
      );
    }
    if (query.from || query.to) {
      const zone = await tenantTimezoneOf(this.dataSource.manager, tenantId);
      if (query.from) {
        qb.andWhere('o.createdAt >= :from', {
          from: startOfDayInZone(query.from, zone),
        });
      }
      if (query.to) {
        const end = startOfDayInZone(query.to, zone)!;
        qb.andWhere('o.createdAt < :to', {
          to: new Date(end.getTime() + 24 * 60 * 60 * 1000),
        });
      }
    }

    const [data, total] = await qb
      .orderBy('o.createdAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();
    return paginated(data, total, page, limit);
  }

  async findOrder(id: string, tenantId: string): Promise<DeliveryOrder> {
    const order = await this.orderQuery(tenantId)
      .leftJoinAndSelect('invoice.lines', 'line')
      .andWhere('o.id = :id', { id })
      .orderBy('line.sortOrder', 'ASC')
      .getOne();
    if (!order) throw new NotFoundException(ORDER_NOT_FOUND);
    return order;
  }

  /** لوحة التوصيل: أعداد الحالات، المتأخر، ومال المحل مع الجهات */
  async summary(tenantId: string): Promise<DeliverySummary> {
    const zone = await tenantTimezoneOf(this.dataSource.manager, tenantId);
    const today = startOfDayInZone(dateOnly(new Date(), zone), zone)!;

    const params: unknown[] = [tenantId, today];
    let scope = '';
    const scoped = scopedWarehouseIds();
    if (scoped) {
      params.push(scoped);
      scope = ` AND o."warehouseId" = ANY($3::uuid[])`;
    }

    const [row] = await this.dataSource.query<Record<string, string | null>[]>(
      `SELECT
         COUNT(*) FILTER (WHERE o."status" = 'new') AS "new",
         COUNT(*) FILTER (WHERE o."status" = 'assigned') AS "assigned",
         COUNT(*) FILTER (WHERE o."status" = 'out_for_delivery') AS "out_for_delivery",
         COUNT(*) FILTER (WHERE o."status" = 'delivered' AND o."deliveredAt" >= $2) AS "delivered",
         COUNT(*) FILTER (WHERE o."status" = 'failed' AND o."failedAt" >= $2) AS "failed",
         COUNT(*) FILTER (WHERE o."status" = 'cancelled' AND o."cancelledAt" >= $2) AS "cancelled",
         COUNT(*) FILTER (WHERE o."status" = 'out_for_delivery'
                            AND z."estimatedMinutes" IS NOT NULL
                            AND o."dispatchedAt" + make_interval(mins => z."estimatedMinutes") < now()) AS "late",
         COALESCE(SUM(o."codAmount") FILTER (WHERE o."status" = 'delivered'
                            AND o."settlementId" IS NULL), 0) AS "held",
         COALESCE(SUM(o."codAmount") FILTER (WHERE o."status" = 'out_for_delivery'), 0) AS "outCod"
       FROM "delivery_orders" o
       LEFT JOIN "delivery_zones" z ON z."id" = o."zoneId"
      WHERE o."tenantId" = $1 AND o."deletedAt" IS NULL${scope}`,
      params,
    );

    const counts = Object.fromEntries(
      DELIVERY_STATUSES.map((status) => [status, Number(row?.[status] ?? 0)]),
    ) as Record<DeliveryOrderStatus, number>;
    return {
      counts,
      lateCount: Number(row?.late ?? 0),
      heldTotal: Number(row?.held ?? 0),
      outCodTotal: Number(row?.outCod ?? 0),
    };
  }

  /**
   * أوردر جديد: فاتورة بيع مسودة بأصنافه وسطر رسوم التوصيل. لا تخرج البضاعة
   * ولا يُسجَّل دفع حتى يخرج الأوردر مع الجهة.
   */
  async createOrder(
    dto: CreateDeliveryOrderDto,
    tenantId: string,
    userId?: string,
  ): Promise<DeliveryOrder> {
    assertWarehouseAllowed(dto.warehouseId);
    const prepaidMethod = paymentMethodOf(dto.paymentMode, dto.prepaidMethod);

    const zone = dto.zoneId
      ? await this.activeZone(dto.zoneId, tenantId)
      : null;
    const agent = dto.agentId
      ? await this.activeAgent(dto.agentId, tenantId)
      : null;
    const deliveryFee = dto.deliveryFee ?? zone?.fee ?? 0;

    const lines = [...dto.lines];
    if (deliveryFee > 0) {
      const feeProduct = await this.deliveryFeeProduct(tenantId);
      lines.push({
        productId: feeProduct.id,
        quantity: 1,
        unitPrice: deliveryFee,
      });
    }

    const timezone = await tenantTimezoneOf(this.dataSource.manager, tenantId);
    const invoice = await this.invoices.create(
      {
        warehouseId: dto.warehouseId,
        customerId: dto.customerId ?? null,
        invoiceDate: dateOnly(new Date(), timezone),
        note: `توصيل: ${dto.recipientName.trim()} — ${dto.phone.trim()}`,
        lines,
      },
      tenantId,
      userId,
      { delivery: true },
    );

    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const number = await nextDocumentNumber(
          manager,
          'delivery_orders',
          ORDER_PREFIX,
          tenantId,
        );
        const codAmount =
          dto.paymentMode === DeliveryPaymentMode.COD ? invoice.total : 0;
        const now = new Date();
        const order = await manager.save(
          manager.create(DeliveryOrder, {
            tenantId,
            number,
            invoiceId: invoice.id,
            warehouseId: dto.warehouseId,
            customerId: dto.customerId ?? null,
            recipientName: dto.recipientName.trim(),
            phone: dto.phone.trim(),
            address: dto.address.trim(),
            zoneId: zone?.id ?? null,
            agentId: agent?.id ?? null,
            status: agent
              ? DeliveryOrderStatus.ASSIGNED
              : DeliveryOrderStatus.NEW,
            paymentMode: dto.paymentMode,
            prepaidMethod,
            codAmount,
            deliveryFee,
            agentFee: agent
              ? (dto.agentFee ??
                (await suggestedAgentFee(manager, agent, codAmount, tenantId)))
              : 0,
            trackingNumber: dto.trackingNumber?.trim() || null,
            note: dto.note ?? null,
            assignedAt: agent ? now : null,
            createdById: userId ?? null,
          }),
        );
        return order.id;
      });
      return this.findOrder(id, tenantId);
    } catch (error) {
      // الأوردر لم يُحفظ: لا تبقَ فاتورته مسودة يتيمة
      await this.invoices
        .cancel(invoice.id, tenantId, { delivery: true })
        .catch(() => undefined);
      throw error;
    }
  }

  /** إسناد (أو إعادة إسناد) لطيار أو شركة شحن قبل الخروج */
  async assign(
    id: string,
    dto: AssignDeliveryOrderDto,
    tenantId: string,
  ): Promise<DeliveryOrder> {
    const agent = await this.activeAgent(dto.agentId, tenantId);
    await this.dataSource.transaction(async (manager) => {
      const order = await this.lockOrder(manager, id, tenantId);
      assertOrderStatus(
        order,
        [DeliveryOrderStatus.NEW, DeliveryOrderStatus.ASSIGNED],
        'إسناد',
      );
      const agentChanged = order.agentId !== agent.id;
      await manager.update(
        DeliveryOrder,
        { id, tenantId },
        {
          agentId: agent.id,
          status: DeliveryOrderStatus.ASSIGNED,
          agentFee:
            dto.agentFee ??
            (agentChanged
              ? await suggestedAgentFee(
                  manager,
                  agent,
                  order.codAmount,
                  tenantId,
                )
              : order.agentFee),
          ...(dto.trackingNumber !== undefined
            ? { trackingNumber: dto.trackingNumber?.trim() || null }
            : {}),
          ...(agentChanged || !order.assignedAt
            ? { assignedAt: new Date() }
            : {}),
        },
      );
    });
    return this.findOrder(id, tenantId);
  }

  /**
   * خروج الأوردر مع الجهة: تصدر الفاتورة فتخرج البضاعة، ويُسجَّل ثمنها
   * كاملاً — "courier" (على الجهة حتى تسويتها) للتحصيل عند الاستلام، أو
   * طريقة الدفع المقدّم.
   */
  async dispatch(
    id: string,
    tenantId: string,
    userId?: string,
  ): Promise<DeliveryOrder> {
    await this.dataSource.transaction(async (manager) => {
      const order = await this.lockOrder(manager, id, tenantId);
      assertOrderStatus(order, [DeliveryOrderStatus.ASSIGNED], 'إخراج');
      if (!order.agentId) {
        throw new BadRequestException('أسند الأوردر لطيار أو شركة شحن أولاً');
      }
      const invoice = await manager.findOneOrFail(SalesInvoice, {
        where: { id: order.invoiceId, tenantId },
      });

      await this.invoices.issueWithin(
        manager,
        invoice.id,
        {
          payments:
            invoice.total > 0
              ? [
                  {
                    method:
                      order.paymentMode === DeliveryPaymentMode.COD
                        ? SalesPaymentMethod.COURIER
                        : (order.prepaidMethod as SalesPaymentMethod),
                    amount: invoice.total,
                    reference: order.trackingNumber ?? order.number,
                  },
                ]
              : [],
        },
        tenantId,
        userId,
        { delivery: true },
      );

      await manager.update(
        DeliveryOrder,
        { id, tenantId },
        {
          status: DeliveryOrderStatus.OUT,
          dispatchedAt: new Date(),
          codAmount:
            order.paymentMode === DeliveryPaymentMode.COD ? invoice.total : 0,
        },
      );
    });
    return this.findOrder(id, tenantId);
  }

  /** سُلّم للعميل: المبلغ (للتحصيل عند الاستلام) أصبح مع الجهة */
  async deliver(id: string, tenantId: string): Promise<DeliveryOrder> {
    await this.dataSource.transaction(async (manager) => {
      const order = await this.lockOrder(manager, id, tenantId);
      assertOrderStatus(order, [DeliveryOrderStatus.OUT], 'تأكيد تسليم');
      await manager.update(
        DeliveryOrder,
        { id, tenantId },
        { status: DeliveryOrderStatus.DELIVERED, deliveredAt: new Date() },
      );
    });
    return this.findOrder(id, tenantId);
  }

  /**
   * لم يُسلَّم (رفض، عنوان خطأ، لا يرد…): مرتجع كامل يعيد البضاعة للمخزن
   * ويعكس ما سُجّل على الفاتورة بنفس طريقته. تكلفة الجهة تبقى (المشوار تم)
   * وتُحسم في التسوية.
   */
  async fail(
    id: string,
    dto: FailDeliveryOrderDto,
    tenantId: string,
    userId?: string,
  ): Promise<DeliveryOrder> {
    const timezone = await tenantTimezoneOf(this.dataSource.manager, tenantId);
    await this.dataSource.transaction(async (manager) => {
      const order = await this.lockOrder(manager, id, tenantId);
      assertOrderStatus(order, [DeliveryOrderStatus.OUT], 'تسجيل عدم تسليم');
      const invoice = await this.invoices.lock(
        manager,
        order.invoiceId,
        tenantId,
      );
      const now = new Date();

      const returnId = await this.returns.returnInFull(
        manager,
        invoice.id,
        {
          returnDate: dateOnly(now, timezone),
          reason: `أوردر توصيل ${order.number} لم يُسلَّم: ${dto.reason}`,
          refund:
            invoice.paidAmount > 0
              ? {
                  method:
                    order.paymentMode === DeliveryPaymentMode.COD
                      ? SalesPaymentMethod.COURIER
                      : (order.prepaidMethod as SalesPaymentMethod),
                  amount: invoice.paidAmount,
                  reference: order.trackingNumber ?? order.number,
                }
              : undefined,
        },
        tenantId,
        userId,
      );

      await manager.update(
        DeliveryOrder,
        { id, tenantId },
        {
          status: DeliveryOrderStatus.FAILED,
          failedAt: now,
          failReason: dto.reason,
          returnId,
          codAmount: 0,
        },
      );
    });
    return this.findOrder(id, tenantId);
  }

  /** إلغاء قبل الخروج: تُلغى مسودة الفاتورة (لا بضاعة خرجت ولا مال) */
  async cancel(id: string, tenantId: string): Promise<DeliveryOrder> {
    const order = await this.findOrder(id, tenantId);
    assertOrderStatus(
      order,
      [DeliveryOrderStatus.NEW, DeliveryOrderStatus.ASSIGNED],
      'إلغاء',
    );
    // الإلغاء المشروط: من سبق بتغيير الحالة (خروج متزامن) يفوز
    const result = await this.orders.update(
      { id, tenantId, status: order.status },
      { status: DeliveryOrderStatus.CANCELLED, cancelledAt: new Date() },
    );
    if (!result.affected) {
      throw new ConflictException('تغيّرت حالة الأوردر — حدّث الصفحة');
    }
    try {
      await this.invoices.cancel(order.invoiceId, tenantId, { delivery: true });
    } catch (error) {
      // الفاتورة لم تُلغَ: نعيد الأوردر لحالته
      await this.orders.update(
        { id, tenantId },
        { status: order.status, cancelledAt: null },
      );
      throw error;
    }
    return this.findOrder(id, tenantId);
  }

  // ══════════════════════════ التسويات ══════════════════════════

  async findSettlements(
    tenantId: string,
    query: DeliverySettlementQueryDto,
  ): Promise<Paginated<DeliverySettlement>> {
    const { page, limit, skip } = resolvePagination(query);
    const [data, total] = await this.settlements.findAndCount({
      where: {
        tenantId,
        ...(query.agentId ? { agentId: query.agentId } : {}),
      },
      relations: { agent: true },
      withDeleted: true,
      order: { settledAt: 'DESC' },
      skip,
      take: limit,
    });
    return paginated(data, total, page, limit);
  }

  async findSettlement(
    id: string,
    tenantId: string,
  ): Promise<DeliverySettlement & { orders: DeliveryOrder[] }> {
    const settlement = await this.settlements.findOne({
      where: { id, tenantId },
      relations: { agent: true },
      withDeleted: true,
    });
    if (!settlement) throw new NotFoundException('التسوية غير موجودة');
    const orders = await this.orderQuery(tenantId)
      .andWhere('o.settlementId = :id', { id })
      .orderBy('o.number', 'ASC')
      .getMany();
    return Object.assign(settlement, { orders });
  }

  /**
   * تسوية جهة: تُغلق أوردرات انتهت (سُلّمت أو رجعت). المتوقع = ما حصّلته من
   * أوردرات التحصيل المسلّمة − رسومها، والفرق عن المستلم فعلاً يُسجَّل
   * (سالب = عجز على الجهة).
   */
  async settle(
    dto: CreateDeliverySettlementDto,
    tenantId: string,
    userId?: string,
  ): Promise<DeliverySettlement & { orders: DeliveryOrder[] }> {
    const agent = await this.findAgent(dto.agentId, tenantId);
    const orderIds = [...new Set(dto.orderIds)];
    const decimals = await moneyDecimalsOf(this.dataSource.manager, tenantId);

    const id = await this.dataSource.transaction(async (manager) => {
      const orders = await manager.find(DeliveryOrder, {
        where: { tenantId, id: In(orderIds) },
        lock: { mode: 'pessimistic_write' },
      });
      if (orders.length !== orderIds.length) {
        throw new NotFoundException('بعض الأوردرات غير موجودة');
      }
      for (const order of orders) {
        assertWarehouseVisible(order.warehouseId, ORDER_NOT_FOUND);
        if (order.agentId !== agent.id) {
          throw new BadRequestException(
            `الأوردر ${order.number} ليس مع "${agent.name}"`,
          );
        }
        if (order.settlementId) {
          throw new BadRequestException(`الأوردر ${order.number} سُوّي من قبل`);
        }
        if (!FINISHED_STATUSES.includes(order.status)) {
          throw new BadRequestException(
            `الأوردر ${order.number} حالته "${STATUS_LABEL[order.status]}" — التسوية للمسلَّم أو الراجع فقط`,
          );
        }
      }

      const collectedTotal = sumMoney(
        orders
          .filter((o) => o.status === DeliveryOrderStatus.DELIVERED)
          .map((o) => o.codAmount),
      );
      const feesTotal = roundMoney(
        dto.feesTotal ?? sumMoney(orders.map((o) => o.agentFee)),
        decimals,
      );
      const expectedAmount = sumMoney([collectedTotal, -feesTotal]);
      const receivedAmount = roundMoney(dto.receivedAmount, decimals);

      const number = await nextDocumentNumber(
        manager,
        'delivery_settlements',
        SETTLEMENT_PREFIX,
        tenantId,
      );
      const settlement = await manager.save(
        manager.create(DeliverySettlement, {
          tenantId,
          number,
          agentId: agent.id,
          settledAt: new Date(),
          ordersCount: orders.length,
          collectedTotal,
          feesTotal,
          expectedAmount,
          receivedAmount,
          difference: sumMoney([receivedAmount, -expectedAmount]),
          method: dto.method,
          note: dto.note ?? null,
          createdById: userId ?? null,
        }),
      );
      await manager.update(
        DeliveryOrder,
        { tenantId, id: In(orderIds) },
        { settlementId: settlement.id },
      );
      return settlement.id;
    });

    return this.findSettlement(id, tenantId);
  }

  // ══════════════════════════ مساعدات ══════════════════════════

  private orderQuery(tenantId: string) {
    const qb = this.orders
      .createQueryBuilder('o')
      // الجهة أو المنطقة المحذوفة تبقى ظاهرة على أوردراتها القديمة
      .withDeleted()
      .leftJoinAndSelect('o.agent', 'agent')
      .leftJoinAndSelect('o.zone', 'zone')
      .leftJoin('o.invoice', 'invoice')
      .addSelect([
        'invoice.id',
        'invoice.number',
        'invoice.status',
        'invoice.total',
        'invoice.paidAmount',
        'invoice.returnedAmount',
        'invoice.customerId',
      ])
      .where('o.tenantId = :tenantId', { tenantId })
      .andWhere('o.deletedAt IS NULL');
    return restrictToScopedWarehouses(qb, 'o.warehouseId');
  }

  private async lockOrder(
    manager: EntityManager,
    id: string,
    tenantId: string,
  ): Promise<DeliveryOrder> {
    const order = await manager.findOne(DeliveryOrder, {
      where: { id, tenantId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!order) throw new NotFoundException(ORDER_NOT_FOUND);
    assertWarehouseVisible(order.warehouseId, ORDER_NOT_FOUND);
    return order;
  }

  private async activeAgent(
    id: string,
    tenantId: string,
  ): Promise<DeliveryAgent> {
    const agent = await this.agents.findOne({ where: { id, tenantId } });
    if (!agent) throw new NotFoundException('جهة التوصيل غير موجودة');
    if (!agent.isActive) {
      throw new BadRequestException(`"${agent.name}" موقوف`);
    }
    return agent;
  }

  private async activeZone(
    id: string,
    tenantId: string,
  ): Promise<DeliveryZone> {
    const zone = await this.findZone(id, tenantId);
    if (!zone.isActive) {
      throw new BadRequestException(`منطقة "${zone.name}" موقوفة`);
    }
    return zone;
  }

  /**
   * صنف خدمة "رسوم التوصيل" تُفوتر به الرسوم على العميل (بلا مخزون، بضريبة
   * الشركة الافتراضية). يُنشأ تلقائياً أول مرة ويُعاد تفعيله إن أُوقف.
   */
  private async deliveryFeeProduct(tenantId: string): Promise<Product> {
    const existing = await this.dataSource.manager.findOne(Product, {
      where: { tenantId, sku: DELIVERY_FEE_SKU },
    });
    if (existing) {
      if (!existing.isActive) {
        await this.dataSource.manager.update(
          Product,
          { id: existing.id, tenantId },
          { isActive: true },
        );
      }
      return existing;
    }

    // الوحدات الافتراضية تُنشأ عند أول استخدام للأصناف: "قطعة" للخدمة
    await this.catalogSettings.ensureDefaults(tenantId);
    const units = await this.dataSource.manager.find(Unit, {
      where: { tenantId, isActive: true },
      order: { createdAt: 'ASC' },
    });
    const unit =
      units.find((u) => u.name === SERVICE_UNIT_NAME) ??
      units.find((u) => !u.allowsFractions) ??
      units[0];
    if (!unit) {
      throw new BadRequestException(
        'أضف وحدة قياس واحدة على الأقل لتُفوتر رسوم التوصيل',
      );
    }
    try {
      return await this.products.create(
        {
          name: DELIVERY_FEE_NAME,
          sku: DELIVERY_FEE_SKU,
          type: ProductType.SERVICE,
          baseUnitId: unit.id,
          salePrice: 0,
          openPrice: true,
        },
        tenantId,
      );
    } catch (error) {
      // طلبان متزامنان أنشآه معاً: نأخذ ما أنشأه الآخر
      const raced = await this.dataSource.manager.findOne(Product, {
        where: { tenantId, sku: DELIVERY_FEE_SKU },
      });
      if (raced) return raced;
      throw error;
    }
  }
}

/** طريقة الدفع المقدّم: إجبارية للمدفوع مقدماً، ولا معنى لها للتحصيل */
function paymentMethodOf(
  mode: DeliveryPaymentMode,
  method?: SalesPaymentMethod,
): string | null {
  if (mode === DeliveryPaymentMode.COD) return null;
  if (!method) {
    throw new BadRequestException(
      'المدفوع مقدماً: حدّد كيف دُفع (تحويل، بطاقة…)',
    );
  }
  return method;
}

/** تكلفة الجهة المقترحة: أجرتها الثابتة + نسبة التحصيل من المبلغ */
async function suggestedAgentFee(
  manager: EntityManager,
  agent: DeliveryAgent,
  codAmount: number,
  tenantId: string,
): Promise<number> {
  const decimals = await moneyDecimalsOf(manager, tenantId);
  return roundMoney(
    new Decimal(agent.defaultFee).plus(
      new Decimal(codAmount).mul(agent.codFeePercent).div(100),
    ),
    decimals,
  );
}

function assertOrderStatus(
  order: DeliveryOrder,
  allowed: DeliveryOrderStatus[],
  action: string,
): void {
  if (!allowed.includes(order.status)) {
    throw new BadRequestException(
      `لا يمكن ${action} أوردر حالته "${STATUS_LABEL[order.status]}"`,
    );
  }
}
