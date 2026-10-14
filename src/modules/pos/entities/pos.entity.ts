// src/modules/pos/entities/pos.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';
import { Warehouse } from '../../inventory/entities/warehouse.entity';

const money = {
  type: 'numeric' as const,
  precision: 15,
  scale: 3,
  default: 0,
  transformer: decimalTransformer,
};

/**
 * جهاز كاشير (نقطة بيع) مربوط بمخزن فرع: كل ما يبيعه يخرج من ذلك المخزن.
 * يعمل بلا إنترنت، لذلك يولّد أرقام فواتيره بنفسه: `كود الجهاز-عدّاد محلي`.
 */
@Entity('pos_devices')
// الكود بادئة أرقام الفواتير: يبقى فريداً حتى بعد حذف الجهاز (لا يُعاد استخدامه)
@Index(['tenantId', 'code'], { unique: true })
export class PosDevice extends TenantOwnedEntity {
  @Column()
  name!: string;

  /** بادئة أرقام فواتيره: POS1 ← POS1-000001 */
  @Column({ type: 'varchar', length: 10 })
  code!: string;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouseId' })
  warehouse?: Warehouse;

  /**
   * آخر عدّاد فاتورة وصل من الجهاز. إذا أُعيد تهيئة الجهاز (مسح بياناته)
   * يكمل من بعده فلا تتكرر أرقامه.
   */
  @Column({ type: 'int', default: 0 })
  lastCounter!: number;

  /**
   * المتصفح (التثبيت) المربوط بهذا الجهاز — واحد فقط.
   *
   * كل متصفح يحتفظ بنسخته المحلية: عدّاد فواتيره، ورديته، وما باعه. لو عمل
   * متصفحان على نفس الجهاز لولّدا نفس أرقام الفواتير ورأى كلٌّ منهما مبيعاته
   * فقط عند تقفيل الوردية. لذلك: جهاز كاشير لكل شاشة بيع.
   * null = غير مربوط بعد (أو فُكّ ربطه).
   */
  @Column({ type: 'uuid', nullable: true })
  installationId?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  boundAt?: Date | null;

  /**
   * بصمة (SHA-256) مفتاح الجهاز: به ترفع الشاشة مبيعاتها وتسحب الأسعار دون
   * جلسة مستخدم. يصدر عند الربط ويُعرض للشاشة مرة واحدة؛ فكّ الربط أو إيقاف
   * الجهاز يُبطله. لا يُقرأ في الاستعلامات العادية ولا يخرج في أي رد.
   */
  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  keyHash?: string | null;

  /**
   * هل كان آخر مستخدم سجّل دخوله على هذه الشاشة يملك صلاحية المرتجع؟ يُعتمد
   * عليه لوردية بلا كاشير محدد حين ترفع الشاشة بمفتاحها دون جلسة.
   */
  @Column({ default: false })
  returnsAllowed!: boolean;

  /** آخر مرة تواصل فيها الجهاز مع السيرفر */
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt?: Date | null;

  @Column({ default: true })
  isActive!: boolean;

  /** ليس عموداً: هل عليه وردية مفتوحة الآن */
  hasOpenShift?: boolean;
}

/**
 * كاشير: شخص يفتح وردية على شاشة البيع برقمه السري — حتى بلا إنترنت.
 *
 * ليس حساب مستخدم: لا بريد ولا دخول للوحة التحكم. قائمة الكاشيرات تنزل لكل
 * جهاز مع الأصناف، والتحقق من الرقم يتم على الجهاز نفسه؛ لذلك يُخزَّن الرقم
 * مشتقاً (PBKDF2) لا نصاً، هنا وعلى الأجهزة.
 */
@Entity('pos_cashiers')
export class PosCashier extends TenantOwnedEntity {
  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 64, select: false })
  pinSalt!: string;

  @Column({ type: 'varchar', length: 128, select: false })
  pinHash!: string;

  @Column({ type: 'int', select: false })
  pinIterations!: number;

  /** يُسمح له بعمل مرتجع وردّ مبلغ من الدرج */
  @Column({ default: false })
  canReturn!: boolean;

  /**
   * متى سُحبت منه صلاحية المرتجع (أو أُوقف/حُذف وهو يملكها). مرتجع سجّله
   * جهاز غير متصل قبل هذه اللحظة يُقبل: النقد خرج من الدرج فعلاً والجهاز لم
   * يكن يعلم بالسحب.
   */
  @Column({ type: 'timestamptz', nullable: true })
  returnRevokedAt?: Date | null;

  /**
   * مشرف: يوافق برقمه السري على ما يتجاوز صلاحية الكاشير (خصم فوق الحد، بيع
   * تحت أقل سعر، وما تشترط إعدادات الشركة موافقة عليه).
   */
  @Column({ default: false })
  isSupervisor!: boolean;

  /**
   * أقصى خصم يدوي يمنحه على الفاتورة (% من قيمتها). null = بلا حد. تجاوزه
   * يحتاج موافقة مشرف. عروض الإدارة لا تُحسب منه.
   */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  maxDiscountPercent?: number | null;

  @Column({ default: true })
  isActive!: boolean;
}

export enum PosShiftStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

/**
 * وردية كاشير على جهاز: من فتح الدرج بعهدة نقدية حتى تقفيله وعدّ ما فيه.
 * المعرّف يولّده الجهاز (الوردية قد تُفتح بلا إنترنت وتُرفع لاحقاً).
 */
@Entity('pos_shifts')
@Index(['tenantId', 'deviceId', 'status'])
@Index(['tenantId', 'openedAt'])
// وردية مفتوحة واحدة لكل جهاز: طلبا مزامنة متزامنان لا يفتحان اثنتين
@Index('UQ_pos_shifts_open_device', ['deviceId'], {
  unique: true,
  where: `"status" = 'open'`,
})
export class PosShift {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  deviceId!: string;

  @ManyToOne(() => PosDevice, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'deviceId' })
  device?: PosDevice;

  @Column({ type: 'uuid', nullable: true })
  userId?: string | null;

  /** الكاشير الذي فتح الوردية برقمه السري (null = وردية بلا كاشير محدد) */
  @Column({ type: 'uuid', nullable: true })
  cashierId?: string | null;

  /** اسم الكاشير وقت الوردية (للتقارير، حتى لو تغيّر المستخدم لاحقاً) */
  @Column({ type: 'varchar', length: 150, nullable: true })
  cashierName?: string | null;

  @Column({ type: 'enum', enum: PosShiftStatus, default: PosShiftStatus.OPEN })
  status!: PosShiftStatus;

  @Column({ type: 'timestamptz' })
  openedAt!: Date;

  /** العهدة النقدية في الدرج عند الفتح */
  @Column(money)
  openingCash!: number;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt?: Date | null;

  // ─── تُحسب عند التقفيل ───
  @Column({ type: 'int', default: 0 })
  invoicesCount!: number;

  @Column(money)
  salesTotal!: number;

  @Column(money)
  cashTotal!: number;

  @Column(money)
  cardTotal!: number;

  /** مرتجعات سُجّلت في الوردية (من فواتيرها أو من فواتير أقدم) */
  @Column({ type: 'int', default: 0 })
  returnsCount!: number;

  @Column(money)
  returnsTotal!: number;

  /** ما رُدّ نقداً من الدرج */
  @Column(money)
  cashRefunds!: number;

  /** ما بيع على الحساب (آجل) لعملاء مسجّلين: لم يدخل الدرج */
  @Column(money)
  creditTotal!: number;

  /** نقد أُودع في الدرج خلال الوردية بلا بيع (فكّة، عهدة إضافية) */
  @Column(money)
  cashIn!: number;

  /** نقد سُحب من الدرج بلا مرتجع (مصروف نثري، توريد للخزنة) */
  @Column(money)
  cashOut!: number;

  /** مرات فتح الدرج يدوياً بلا بيع (للمراجعة) */
  @Column({ type: 'int', default: 0 })
  drawerOpens!: number;

  /**
   * المفترض في الدرج =
   * العهدة + المبيعات النقدية − المردود نقداً + الإيداعات − المسحوبات
   */
  @Column(money)
  expectedCash!: number;

  /** ما عدّه الكاشير فعلاً عند التقفيل */
  @Column({ ...money, nullable: true, default: null })
  closingCash?: number | null;

  /** المعدود − المفترض (سالب = عجز، موجب = زيادة) */
  @Column(money)
  cashDifference!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  /**
   * عمليات (بيع، مرتجع، حركة درج) وصلت بعد تقفيل الوردية — رُفضت أولاً ثم
   * أُعيدت. كل واحدة تعيد حساب أرقام الوردية؛ المعدود عند التقفيل لا يتغيّر.
   */
  @Column({ type: 'int', default: 0 })
  lateOperations!: number;

  /** آخر إعادة حساب بعد التقفيل (null = الأرقام كما حُسبت عند التقفيل) */
  @Column({ type: 'timestamptz', nullable: true })
  recalculatedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
