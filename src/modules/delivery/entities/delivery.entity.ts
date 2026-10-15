// src/modules/delivery/entities/delivery.entity.ts
//
// التوصيل والشحن: نظام واحد لجهتي توصيل — طيار المحل وشركة الشحن. كلتاهما
// تأخذ الأوردر، تحصّل ثمنه من العميل عند التسليم (أو توصّل مدفوعاً مقدماً)، ثم
// تُسوّى: تسلّم ما حصّلته بعد خصم أجرتها/رسومها.
//
// الأوردر لا يملك مبالغه: خلفه فاتورة بيع عادية (مسودة عند الإنشاء، تصدر عند
// خروجه مع الجهة) فتمرّ بنفس مسار المخزون والترقيم والضريبة. التحصيل عند
// التسليم يُسجَّل على الفاتورة بطريقة "courier": العميل غير مدين، والمبلغ على
// الجهة حتى تسويتها.
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';
import { SalesInvoice } from '../../sales/entities/sales-invoice.entity';

const money = {
  type: 'numeric' as const,
  precision: 15,
  scale: 3,
  default: 0,
  transformer: decimalTransformer,
};

export enum DeliveryAgentType {
  /** طيار المحل: يقفّل حسابه مع المحل (غالباً آخر كل مشوار أو يوم) */
  DRIVER = 'driver',
  /** شركة شحن: تحوّل ما حصّلته بكشف دوري بعد خصم رسومها */
  CARRIER = 'carrier',
}

/** جهة توصيل: طيار أو شركة شحن */
@Entity('delivery_agents')
@Index(['tenantId', 'name'], { unique: true, where: '"deletedAt" IS NULL' })
export class DeliveryAgent extends TenantOwnedEntity {
  @Column({ type: 'enum', enum: DeliveryAgentType })
  type!: DeliveryAgentType;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string | null;

  /**
   * تكلفة التوصيل علينا لكل أوردر: أجرة الطيار أو رسوم شركة الشحن. تُقترح على
   * الأوردر عند إسناده، والمعتمد ما يُسجَّل في التسوية.
   */
  @Column(money)
  defaultFee!: number;

  /** رسوم التحصيل % من المبلغ المحصّل (تفرضها شركات الشحن غالباً) */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  codFeePercent!: number;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note?: string | null;

  /** ليس عموداً: ما معها الآن من مال المحل (أوردرات مسلّمة لم تُسوَّ) */
  heldAmount?: number;
  /** ليس عموداً: أوردرات معها في الطريق */
  outCount?: number;
  /** ليس عموداً: أوردرات انتهت (سُلّمت أو رجعت) ولم تُسوَّ */
  unsettledCount?: number;
}

/** منطقة توصيل: رسومها على العميل والوقت المتوقع */
@Entity('delivery_zones')
@Index(['tenantId', 'name'], { unique: true, where: '"deletedAt" IS NULL' })
export class DeliveryZone extends TenantOwnedEntity {
  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /** رسوم التوصيل على العميل (سطر في فاتورته) */
  @Column(money)
  fee!: number;

  /** الوقت المتوقع للتوصيل بالدقائق: بعده يظهر الأوردر متأخراً */
  @Column({ type: 'int', nullable: true })
  estimatedMinutes?: number | null;

  @Column({ default: true })
  isActive!: boolean;
}

export enum DeliveryOrderStatus {
  /** جديد: الفاتورة مسودة، لم يُسند لجهة */
  NEW = 'new',
  /** أُسند لطيار أو شركة شحن، ولم يخرج بعد */
  ASSIGNED = 'assigned',
  /** خرج مع الجهة: الفاتورة صدرت والبضاعة خرجت من المخزن */
  OUT = 'out_for_delivery',
  /** سُلّم للعميل (وحُصّل ثمنه إن كان عند الاستلام) */
  DELIVERED = 'delivered',
  /** لم يُسلَّم (رفض العميل، عنوان خطأ…): مرتجع كامل وعادت البضاعة */
  FAILED = 'failed',
  /** أُلغي قبل خروجه: أُلغيت مسودة فاتورته */
  CANCELLED = 'cancelled',
}

export enum DeliveryPaymentMode {
  /** تحصيل عند الاستلام: الجهة تحصّل وتسلّم المحل عند التسوية */
  COD = 'cod',
  /** مدفوع مقدماً (أونلاين، تحويل، بطاقة): الجهة توصّل فقط */
  PREPAID = 'prepaid',
}

@Entity('delivery_orders')
@Index(['tenantId', 'number'], { unique: true })
@Index(['tenantId', 'status'])
@Index(['tenantId', 'agentId', 'settlementId'])
export class DeliveryOrder extends TenantOwnedEntity {
  /** DLV-000001 */
  @Column({ type: 'varchar', length: 30 })
  number!: string;

  /** فاتورة البيع خلف الأوردر: مسودة حتى خروجه، ثم صادرة */
  @Index({ unique: true })
  @Column({ type: 'uuid' })
  invoiceId!: string;

  @ManyToOne(() => SalesInvoice, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invoiceId' })
  invoice?: SalesInvoice;

  /** المخزن الذي تخرج منه البضاعة (وبه يُقيَّد بالفروع) */
  @Column({ type: 'uuid' })
  warehouseId!: string;

  /** عميل مسجّل (اختياري: قد يكون عميلاً عابراً) */
  @Column({ type: 'uuid', nullable: true })
  customerId?: string | null;

  /** المستلم وهاتفه وعنوانه كما على الأوردر (قد يختلف عن العميل) */
  @Column({ type: 'varchar', length: 150 })
  recipientName!: string;

  @Column({ type: 'varchar', length: 30 })
  phone!: string;

  @Column({ type: 'varchar', length: 500 })
  address!: string;

  @Column({ type: 'uuid', nullable: true })
  zoneId?: string | null;

  @ManyToOne(() => DeliveryZone, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'zoneId' })
  zone?: DeliveryZone | null;

  @Column({ type: 'uuid', nullable: true })
  agentId?: string | null;

  @ManyToOne(() => DeliveryAgent, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'agentId' })
  agent?: DeliveryAgent | null;

  @Column({
    type: 'enum',
    enum: DeliveryOrderStatus,
    default: DeliveryOrderStatus.NEW,
  })
  status!: DeliveryOrderStatus;

  @Column({ type: 'enum', enum: DeliveryPaymentMode })
  paymentMode!: DeliveryPaymentMode;

  /** طريقة الدفع المقدّم (للمدفوع مقدماً): تُسجَّل على الفاتورة عند إصدارها */
  @Column({ type: 'varchar', length: 20, nullable: true })
  prepaidMethod?: string | null;

  /** ما تحصّله الجهة من العميل عند التسليم (= إجمالي الفاتورة)؛ 0 للمدفوع */
  @Column(money)
  codAmount!: number;

  /** رسوم التوصيل على العميل (سطر في الفاتورة) */
  @Column(money)
  deliveryFee!: number;

  /** تكلفة التوصيل علينا (أجرة الطيار / رسوم الشركة) — تقدير حتى التسوية */
  @Column(money)
  agentFee!: number;

  /** رقم البوليصة لدى شركة الشحن */
  @Column({ type: 'varchar', length: 80, nullable: true })
  trackingNumber?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  /** سبب عدم التسليم */
  @Column({ type: 'varchar', length: 300, nullable: true })
  failReason?: string | null;

  /** مرتجع البيع الذي أعاد بضاعة أوردر لم يُسلَّم */
  @Column({ type: 'uuid', nullable: true })
  returnId?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  assignedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  dispatchedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  failedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt?: Date | null;

  /** التسوية التي دخل فيها (null = لم يُسوَّ بعد) */
  @Column({ type: 'uuid', nullable: true })
  settlementId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;
}

/**
 * تسوية جهة توصيل: الطيار يسلّم ما حصّله، أو شركة الشحن تحوّل كشفها. لكل
 * تسوية أوردرات انتهت (سُلّمت أو رجعت): المحصّل منها − رسوم الجهة = المتوقع،
 * والفرق عن المستلم فعلاً عجز أو زيادة.
 */
@Entity('delivery_settlements')
@Index(['tenantId', 'number'], { unique: true })
@Index(['tenantId', 'agentId'])
export class DeliverySettlement extends TenantOwnedEntity {
  /** DST-000001 */
  @Column({ type: 'varchar', length: 30 })
  number!: string;

  @Column({ type: 'uuid' })
  agentId!: string;

  @ManyToOne(() => DeliveryAgent, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'agentId' })
  agent?: DeliveryAgent;

  @Column({ type: 'timestamptz' })
  settledAt!: Date;

  @Column({ type: 'int', default: 0 })
  ordersCount!: number;

  /** ما حصّلته الجهة من العملاء (أوردرات التحصيل عند الاستلام المسلّمة) */
  @Column(money)
  collectedTotal!: number;

  /** أجرة الطيار أو رسوم شركة الشحن (تُخصم من المحصّل) */
  @Column(money)
  feesTotal!: number;

  /** المتوقع استلامه = المحصّل − الرسوم */
  @Column(money)
  expectedAmount!: number;

  /** ما استُلم فعلاً */
  @Column(money)
  receivedAmount!: number;

  /** المستلم − المتوقع (سالب = عجز على الجهة) */
  @Column(money)
  difference!: number;

  /** كيف استُلم: نقداً، تحويلاً… */
  @Column({ type: 'varchar', length: 20 })
  method!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;
}
