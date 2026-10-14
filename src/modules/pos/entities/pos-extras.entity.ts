// src/modules/pos/entities/pos-extras.entity.ts
// ما يحيط بالبيع في شاشة الكاشير: حركات الدرج النقدية، سجل التدقيق، والعروض.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';

const money = {
  type: 'numeric' as const,
  precision: 15,
  scale: 3,
  transformer: decimalTransformer,
};

export enum CashMovementType {
  /** إيداع في الدرج (فكّة، عهدة إضافية) */
  IN = 'in',
  /** سحب من الدرج (مصروف نثري، توريد للخزنة) */
  OUT = 'out',
}

/**
 * نقد دخل الدرج أو خرج منه بلا بيع ولا مرتجع. بدونه يظهر المصروف النثري
 * "عجزاً" عند تقفيل الوردية. المعرّف يولّده الجهاز (يُسجَّل بلا إنترنت).
 */
@Entity('pos_cash_movements')
@Index(['tenantId', 'shiftId'])
export class PosCashMovement {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  deviceId!: string;

  @Column({ type: 'uuid' })
  shiftId!: string;

  @Column({ type: 'enum', enum: CashMovementType })
  type!: CashMovementType;

  /** دائماً موجب — النوع يحدد الاتجاه */
  @Column(money)
  amount!: number;

  @Column({ type: 'varchar', length: 300 })
  reason!: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  cashierName?: string | null;

  /** المشرف الذي وافق برقمه السري (إن احتاجت الحركة موافقة) */
  @Column({ type: 'varchar', length: 150, nullable: true })
  approvedBy?: string | null;

  /** وقت الحركة على الجهاز */
  @Column({ type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/** ما يسجّله الكاشير في سجل التدقيق */
export const POS_AUDIT_ACTIONS = [
  'line_removed',
  'cart_cleared',
  'sale_held',
  'held_deleted',
  'drawer_opened',
  'cash_in',
  'cash_out',
  'discount',
  'price_below_min',
  'price_changed',
  'credit_over_limit',
  'approval_denied',
] as const;

/**
 * ما يسجّله السيرفر بنفسه عند رفع عمليات الجهاز — لا يقبله من الجهاز.
 *   stock_overdrawn   بيع نزل بالرصيد تحت الصفر في مخزن لا يسمح بذلك
 *   sale_anomaly      ضريبة تخالف نسبة الصنف، أو سعر تحت الحد بلا موافقة مشرف
 *   late_after_close  عملية وصلت بعد تقفيل ورديتها فأُعيد حساب الوردية
 */
export const POS_SERVER_AUDIT_ACTIONS = [
  'stock_overdrawn',
  'sale_anomaly',
  'late_after_close',
] as const;
export type PosServerAuditAction = (typeof POS_SERVER_AUDIT_ACTIONS)[number];

export type PosAuditAction =
  | (typeof POS_AUDIT_ACTIONS)[number]
  | PosServerAuditAction;

/**
 * سجل تدقيق شاشة الكاشير: ما لا يترك أثراً في الفواتير (حذف سطر، إفراغ سلة،
 * فتح الدرج بلا بيع، خصم، موافقة مشرف). سجل للقراءة فقط — لا يُعدَّل ولا
 * يُحذف. المعرّف يولّده الجهاز.
 */
@Entity('pos_audit_logs')
@Index(['tenantId', 'occurredAt'])
@Index(['tenantId', 'shiftId'])
export class PosAuditLog {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  deviceId!: string;

  @Column({ type: 'uuid', nullable: true })
  shiftId?: string | null;

  @Column({ type: 'varchar', length: 40 })
  action!: PosAuditAction;

  @Column({ type: 'varchar', length: 150, nullable: true })
  cashierName?: string | null;

  /** المشرف الذي وافق (null = لم تحتج موافقة) */
  @Column({ type: 'varchar', length: 150, nullable: true })
  approvedBy?: string | null;

  /** المبلغ المعنيّ: قيمة السطر المحذوف، الخصم، الحركة النقدية… */
  @Column({ ...money, nullable: true })
  amount?: number | null;

  /** وصف مقروء: اسم الصنف وكميته، سبب الحركة، رقم الفاتورة… */
  @Column({ type: 'varchar', length: 500, nullable: true })
  details?: string | null;

  @Column({ type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

export enum PromotionType {
  /** سعر خاص للصنف (لفترة، أو لعميل بعينه) */
  SPECIAL_PRICE = 'special_price',
  /** خصم نسبة على صنف أو تصنيف أو كل الأصناف */
  PERCENT_OFF = 'percent_off',
  /** اشترِ X واحصل على Y مجاناً من نفس الصنف */
  BUY_X_GET_Y = 'buy_x_get_y',
}

/**
 * عرض أو سعر خاص تطبّقه شاشة الكاشير تلقائياً. ينزل للأجهزة مع الأصناف،
 * ويُحسب على الجهاز (يعمل بلا إنترنت)؛ أثره يصل السيرفر كسعر أو خصم على سطر
 * الفاتورة. لا يُطبَّق على فواتير لوحة التحكم.
 */
@Entity('pos_promotions')
@Index(['tenantId', 'updatedAt'])
export class PosPromotion extends TenantOwnedEntity {
  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'enum', enum: PromotionType })
  type!: PromotionType;

  /** الصنف المعنيّ. إلزامي للسعر الخاص و"اشترِ واحصل"؛ اختياري لخصم النسبة */
  @Column({ type: 'uuid', nullable: true })
  productId?: string | null;

  /** لخصم النسبة: كل أصناف تصنيف (إن لم يُحدَّد صنف) */
  @Column({ type: 'uuid', nullable: true })
  categoryId?: string | null;

  /** لعميل بعينه. null = لكل العملاء */
  @Column({ type: 'uuid', nullable: true })
  customerId?: string | null;

  /** السعر الخاص لوحدة الأساس، بنفس أساس سعر الصنف (شامل الضريبة أو قبلها) */
  @Column({ ...money, nullable: true })
  price?: number | null;

  /** نسبة الخصم % */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  percent?: number | null;

  /** اشترِ هذه الكمية… */
  @Column({ type: 'int', nullable: true })
  buyQuantity?: number | null;

  /** …واحصل على هذه مجاناً */
  @Column({ type: 'int', nullable: true })
  getQuantity?: number | null;

  /** بداية السريان ونهايته (null = بلا حد) */
  @Column({ type: 'timestamptz', nullable: true })
  startsAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endsAt?: Date | null;

  @Column({ default: true })
  isActive!: boolean;
}
