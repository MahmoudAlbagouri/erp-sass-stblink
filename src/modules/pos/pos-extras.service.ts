// src/modules/pos/pos-extras.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { sumMoney } from '../../common/utils/document-totals.util';
import { restrictToScopedWarehouses } from '../branches/branch-scope';
import {
  CreatePromotionDto,
  PosAuditOp,
  PosAuditQueryDto,
  PosCashMoveOp,
  PosCashMovementQueryDto,
  UpdatePromotionDto,
} from './dto/pos.dto';
import {
  CashMovementType,
  PosAuditLog,
  PosCashMovement,
  PosPromotion,
  PromotionType,
} from './entities/pos-extras.entity';
import { PosDevice, PosShift } from './entities/pos.entity';

/** عرض كما يخزّنه جهاز الكاشير ليطبّقه بلا إنترنت */
export interface PosPromotionForDevice {
  id: string;
  name: string;
  type: PromotionType;
  productId: string | null;
  categoryId: string | null;
  customerId: string | null;
  price: number | null;
  percent: number | null;
  buyQuantity: number | null;
  getQuantity: number | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface ShiftCashMoves {
  cashIn: number;
  cashOut: number;
}

/**
 * ما يحيط بالبيع في شاشة الكاشير: حركات الدرج النقدية، سجل التدقيق، والعروض.
 * الحركات والسجل يرفعهما الجهاز من طابوره؛ العروض تُدار من لوحة التحكم وتنزل
 * للأجهزة.
 */
@Injectable()
export class PosExtrasService {
  constructor(
    @InjectRepository(PosCashMovement)
    private readonly movements: Repository<PosCashMovement>,
    @InjectRepository(PosAuditLog)
    private readonly audit: Repository<PosAuditLog>,
    @InjectRepository(PosPromotion)
    private readonly promotions: Repository<PosPromotion>,
  ) {}

  // ══════════════════════════ حركات الدرج ══════════════════════════

  /** @returns true إذا كانت الحركة مسجّلة من قبل (رفع مكرر) */
  async recordCashMove(
    op: PosCashMoveOp,
    shift: PosShift,
    device: PosDevice,
  ): Promise<boolean> {
    const existing = await this.movements.findOne({ where: { id: op.id } });
    if (existing) {
      if (existing.tenantId !== device.tenantId) {
        throw new NotFoundException('الحركة غير موجودة');
      }
      return true;
    }
    await this.movements.insert({
      id: op.id,
      tenantId: device.tenantId,
      deviceId: device.id,
      shiftId: shift.id,
      type: op.type,
      amount: op.amount,
      reason: op.reason,
      cashierName: op.cashierName ?? shift.cashierName ?? null,
      approvedBy: op.approvedBy ?? null,
      occurredAt: new Date(op.occurredAt),
    });
    return false;
  }

  /** ما أُودع في درج الوردية وما سُحب منه بلا بيع */
  async shiftCashMoves(
    tenantId: string,
    shiftId: string,
  ): Promise<ShiftCashMoves> {
    const rows = await this.movements
      .createQueryBuilder('move')
      .select('move.type', 'type')
      .addSelect('SUM(move.amount)', 'amount')
      .where('move.tenantId = :tenantId', { tenantId })
      .andWhere('move.shiftId = :shiftId', { shiftId })
      .groupBy('move.type')
      .getRawMany<{ type: CashMovementType; amount: string }>();
    const of = (type: CashMovementType) =>
      sumMoney(
        rows.filter((r) => r.type === type).map((r) => Number(r.amount)),
      );
    return {
      cashIn: of(CashMovementType.IN),
      cashOut: of(CashMovementType.OUT),
    };
  }

  async findCashMovements(
    tenantId: string,
    query: PosCashMovementQueryDto,
  ): Promise<Paginated<PosCashMovement>> {
    const { page, limit, skip } = resolvePagination(query);
    const qb = this.movements
      .createQueryBuilder('move')
      .innerJoin(PosDevice, 'device', 'device.id = move.deviceId')
      .where('move.tenantId = :tenantId', { tenantId });
    restrictToScopedWarehouses(qb, 'device.warehouseId');

    if (query.shiftId) {
      qb.andWhere('move.shiftId = :shiftId', { shiftId: query.shiftId });
    }
    if (query.deviceId) {
      qb.andWhere('move.deviceId = :deviceId', { deviceId: query.deviceId });
    }
    const [data, total] = await qb
      .orderBy('move.occurredAt', 'DESC')
      .addOrderBy('move.id', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();
    return paginated(data, total, page, limit);
  }

  // ══════════════════════════ سجل التدقيق ══════════════════════════

  /** @returns true إذا كان الحدث مسجّلاً من قبل (رفع مكرر) */
  async recordAudit(
    op: PosAuditOp,
    device: PosDevice,
    shift: PosShift | null,
  ): Promise<boolean> {
    const existing = await this.audit.findOne({ where: { id: op.id } });
    if (existing) {
      if (existing.tenantId !== device.tenantId) {
        throw new NotFoundException('الحدث غير موجود');
      }
      return true;
    }
    await this.audit.insert({
      id: op.id,
      tenantId: device.tenantId,
      deviceId: device.id,
      shiftId: shift?.id ?? null,
      action: op.action,
      cashierName: op.cashierName ?? shift?.cashierName ?? null,
      approvedBy: op.approvedBy ?? null,
      amount: op.amount ?? null,
      details: op.details ?? null,
      occurredAt: new Date(op.occurredAt),
    });
    return false;
  }

  async findAudit(
    tenantId: string,
    query: PosAuditQueryDto,
  ): Promise<Paginated<PosAuditLog & { deviceName: string | null }>> {
    const { page, limit, skip } = resolvePagination(query);
    const qb = this.audit
      .createQueryBuilder('log')
      .withDeleted() // حدث على جهاز حُذف لاحقاً يبقى ظاهراً
      .innerJoin(PosDevice, 'device', 'device.id = log.deviceId')
      .addSelect('device.name', 'deviceName')
      .where('log.tenantId = :tenantId', { tenantId });
    restrictToScopedWarehouses(qb, 'device.warehouseId');

    if (query.deviceId) {
      qb.andWhere('log.deviceId = :deviceId', { deviceId: query.deviceId });
    }
    if (query.shiftId) {
      qb.andWhere('log.shiftId = :shiftId', { shiftId: query.shiftId });
    }
    if (query.action) {
      qb.andWhere('log.action = :action', { action: query.action });
    }
    if (query.from)
      qb.andWhere('log.occurredAt >= :from', { from: query.from });
    if (query.to) qb.andWhere('log.occurredAt <= :to', { to: query.to });

    const total = await qb.getCount();
    const { entities, raw } = await qb
      .orderBy('log.occurredAt', 'DESC')
      .addOrderBy('log.id', 'ASC')
      .offset(skip)
      .limit(limit)
      .getRawAndEntities<{ deviceName: string | null }>();

    return paginated(
      entities.map((log, index) => ({
        ...log,
        deviceName: raw[index]?.deviceName ?? null,
      })),
      total,
      page,
      limit,
    );
  }

  // ══════════════════════════ العروض ══════════════════════════

  findPromotions(tenantId: string): Promise<PosPromotion[]> {
    return this.promotions.find({
      where: { tenantId },
      order: { isActive: 'DESC', createdAt: 'DESC' },
    });
  }

  async findPromotion(id: string, tenantId: string): Promise<PosPromotion> {
    const promotion = await this.promotions.findOne({
      where: { id, tenantId },
    });
    if (!promotion) throw new NotFoundException('العرض غير موجود');
    return promotion;
  }

  /**
   * العروض الفعّالة التي لم تنتهِ — القائمة كاملة دائماً (قليلة، وتاريخ
   * السريان تفحصه الشاشة عند كل بيع).
   */
  async findPromotionsForDevice(
    tenantId: string,
    now = new Date(),
  ): Promise<PosPromotionForDevice[]> {
    const rows = await this.promotions
      .createQueryBuilder('promotion')
      .where('promotion.tenantId = :tenantId', { tenantId })
      .andWhere('promotion.isActive = true')
      .andWhere('(promotion.endsAt IS NULL OR promotion.endsAt > :now)', {
        now,
      })
      .orderBy('promotion.createdAt', 'ASC')
      .getMany();

    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      productId: p.productId ?? null,
      categoryId: p.categoryId ?? null,
      customerId: p.customerId ?? null,
      price: p.price ?? null,
      percent: p.percent ?? null,
      buyQuantity: p.buyQuantity ?? null,
      getQuantity: p.getQuantity ?? null,
      startsAt: p.startsAt?.toISOString() ?? null,
      endsAt: p.endsAt?.toISOString() ?? null,
    }));
  }

  async createPromotion(
    dto: CreatePromotionDto,
    tenantId: string,
  ): Promise<PosPromotion> {
    const promotion = this.promotions.create({
      tenantId,
      ...normalizePromotion(dto),
    });
    await this.assertReferences(promotion);
    return this.promotions.save(promotion);
  }

  async updatePromotion(
    id: string,
    dto: UpdatePromotionDto,
    tenantId: string,
  ): Promise<PosPromotion> {
    const promotion = await this.findPromotion(id, tenantId);
    Object.assign(
      promotion,
      normalizePromotion({ ...toDto(promotion), ...dto }),
    );
    await this.assertReferences(promotion);
    return this.promotions.save(promotion);
  }

  async removePromotion(id: string, tenantId: string): Promise<void> {
    await this.promotions.softRemove(await this.findPromotion(id, tenantId));
  }

  /** الصنف والتصنيف والعميل المشار إليهم يجب أن يكونوا من نفس الشركة */
  private async assertReferences(promotion: PosPromotion): Promise<void> {
    const checks: [string, string | null | undefined, string][] = [
      ['products', promotion.productId, 'الصنف غير موجود'],
      ['product_categories', promotion.categoryId, 'التصنيف غير موجود'],
      ['customers', promotion.customerId, 'العميل غير موجود'],
    ];
    for (const [table, id, message] of checks) {
      if (!id) continue;
      const [found] = await this.promotions.manager.query<unknown[]>(
        `SELECT 1 FROM ${table}
          WHERE "id" = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL`,
        [id, promotion.tenantId],
      );
      if (!found) throw new NotFoundException(message);
    }
  }
}

const toDto = (p: PosPromotion): CreatePromotionDto => ({
  name: p.name,
  type: p.type,
  productId: p.productId,
  categoryId: p.categoryId,
  customerId: p.customerId,
  price: p.price,
  percent: p.percent,
  buyQuantity: p.buyQuantity,
  getQuantity: p.getQuantity,
  startsAt: p.startsAt?.toISOString() ?? null,
  endsAt: p.endsAt?.toISOString() ?? null,
  isActive: p.isActive,
});

/**
 * يتحقق من حقول كل نوع ويُفرغ ما لا يخصه، فلا يبقى في العرض حقل من نوع سابق
 * يربك الشاشة.
 */
function normalizePromotion(dto: CreatePromotionDto): Partial<PosPromotion> {
  const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
  const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new BadRequestException('نهاية العرض يجب أن تكون بعد بدايته');
  }
  const base = {
    name: dto.name.trim(),
    type: dto.type,
    customerId: dto.customerId ?? null,
    startsAt,
    endsAt,
    isActive: dto.isActive ?? true,
    productId: dto.productId ?? null,
    categoryId: null as string | null,
    price: null as number | null,
    percent: null as number | null,
    buyQuantity: null as number | null,
    getQuantity: null as number | null,
  };

  switch (dto.type) {
    case PromotionType.SPECIAL_PRICE:
      if (!dto.productId) throw new BadRequestException('اختر الصنف');
      if (dto.price === null || dto.price === undefined) {
        throw new BadRequestException('أدخل السعر الخاص');
      }
      return { ...base, price: dto.price };

    case PromotionType.PERCENT_OFF:
      if (!dto.percent) throw new BadRequestException('أدخل نسبة الخصم');
      return {
        ...base,
        percent: dto.percent,
        // صنف محدد يغلب التصنيف
        categoryId: dto.productId ? null : (dto.categoryId ?? null),
      };

    case PromotionType.BUY_X_GET_Y:
      if (!dto.productId) throw new BadRequestException('اختر الصنف');
      if (!dto.buyQuantity || !dto.getQuantity) {
        throw new BadRequestException('أدخل كمية الشراء والكمية المجانية');
      }
      return {
        ...base,
        buyQuantity: dto.buyQuantity,
        getQuantity: dto.getQuantity,
      };
  }
}
