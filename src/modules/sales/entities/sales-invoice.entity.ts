// src/modules/sales/entities/sales-invoice.entity.ts
import {
  AfterLoad,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';
import { Product } from '../../catalog/entities/product.entity';
import { TaxCategory } from '../../catalog/entities/tax-rate.entity';
import { Unit } from '../../catalog/entities/unit.entity';
import { Warehouse } from '../../inventory/entities/warehouse.entity';
import { Customer } from './customer.entity';

export enum SalesInvoiceStatus {
  /** مسودة / عرض لم يصدر: بلا رقم ولا أثر على المخزون أو حساب العميل */
  DRAFT = 'draft',
  /**
   * صادرة: أخذت رقمها التسلسلي وخرجت بضاعتها. لا تُعدَّل ولا تُلغى بعد ذلك
   * (متطلب هيئة الزكاة والضريبة) — تصحيحها بإشعار دائن (مرتجع بيع).
   */
  ISSUED = 'issued',
  /** مسودة أُلغيت قبل الإصدار */
  CANCELLED = 'cancelled',
}

export enum SalesInvoiceType {
  /** فاتورة ضريبية مبسطة (B2C) */
  SIMPLIFIED = 'simplified',
  /** فاتورة ضريبية (B2B): للعميل رقم ضريبي */
  STANDARD = 'standard',
}

export type PaymentStatus = 'unpaid' | 'partial' | 'paid';

const money = {
  type: 'numeric' as const,
  precision: 14,
  scale: 2,
  default: 0,
  transformer: decimalTransformer,
};

const quantity = {
  type: 'numeric' as const,
  precision: 14,
  scale: 4,
  transformer: decimalTransformer,
};

@Entity('sales_invoices')
// الرقم يُعطى عند الإصدار فقط: المسودات بلا رقم فلا تترك فجوات في التسلسل
@Index(['tenantId', 'number'], { unique: true, where: '"number" IS NOT NULL' })
// uuid يولّده العميل (الكاشير): إعادة رفع نفس الفاتورة لا تكرّرها
@Index(['tenantId', 'uuid'], { unique: true })
@Index(['tenantId', 'customerId'])
@Index(['tenantId', 'status', 'issuedAt'])
export class SalesInvoice extends TenantOwnedEntity {
  @Column({ type: 'uuid' })
  uuid!: string;

  /** INV-000001 — null للمسودة */
  @Column({ type: 'varchar', length: 30, nullable: true })
  number?: string | null;

  @Column({
    type: 'enum',
    enum: SalesInvoiceType,
    default: SalesInvoiceType.SIMPLIFIED,
  })
  invoiceType!: SalesInvoiceType;

  /** null = بيع نقدي لعميل عابر */
  @Column({ type: 'uuid', nullable: true })
  customerId?: string | null;

  @ManyToOne(() => Customer, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customerId' })
  customer?: Customer | null;

  /** المخزن (الفرع) الذي تخرج منه البضاعة */
  @Column({ type: 'uuid' })
  warehouseId!: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouseId' })
  warehouse?: Warehouse;

  @Column({ type: 'date' })
  invoiceDate!: string;

  @Column({ type: 'date', nullable: true })
  dueDate?: string | null;

  @Column({
    type: 'enum',
    enum: SalesInvoiceStatus,
    default: SalesInvoiceStatus.DRAFT,
  })
  status!: SalesInvoiceStatus;

  /** الأسعار المُدخلة في الأسطر شاملة الضريبة (المعتاد في التجزئة) */
  @Column({ default: true })
  pricesIncludeTax!: boolean;

  @Column(money)
  subtotal!: number;

  @Column(money)
  discountTotal!: number;

  @Column(money)
  taxTotal!: number;

  @Column(money)
  total!: number;

  @Column(money)
  paidAmount!: number;

  /** قيمة ما أُرجع من هذه الفاتورة (إشعارات دائنة) */
  @Column(money)
  returnedAmount!: number;

  /** تكلفة البضاعة المباعة بمتوسط التكلفة وقت الإصدار (لحساب الربح) */
  @Column(money)
  costTotal!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;

  /** وقت الإصدار الفعلي (بيع أوفلاين يحتفظ بوقته الأصلي عند الرفع) */
  @Column({ type: 'timestamptz', nullable: true })
  issuedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  issuedById?: string | null;

  // ─── هيئة الزكاة والضريبة ───
  /** رمز QR للمرحلة الأولى (TLV بترميز Base64) — يُولَّد عند الإصدار */
  @Column({ type: 'text', nullable: true })
  qrCode?: string | null;

  /** عدّاد الفواتير الصادرة (ICV): يزيد واحداً مع كل فاتورة بلا فجوات */
  @Column({ type: 'int', nullable: true })
  counter?: number | null;

  /** بصمة الفاتورة، وبصمة التي قبلها: سلسلة تكشف أي حذف أو تعديل */
  @Column({ type: 'varchar', length: 64, nullable: true })
  invoiceHash?: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  previousInvoiceHash?: string | null;

  /** جهاز الكاشير الذي أصدرها (مرحلة نقاط البيع). null = من لوحة التحكم */
  @Column({ type: 'uuid', nullable: true })
  deviceId?: string | null;

  /** وردية الكاشير التي بيعت فيها (لتقفيل الدرج). null = من لوحة التحكم */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  shiftId?: string | null;

  @OneToMany(() => SalesInvoiceLine, (line) => line.invoice)
  lines?: SalesInvoiceLine[];

  // ─── قيم محسوبة (ليست أعمدة) ───
  /** المتبقي على العميل = الإجمالي − المرتجع − المدفوع */
  remaining?: number;
  /** مدفوع زائد عن صافي الفاتورة (بعد مرتجع) — يُردّ للعميل أو يبقى له */
  overpaid?: number;
  paymentStatus?: PaymentStatus;
  linesCount?: number;

  @AfterLoad()
  protected computeDerived(): void {
    const net = round2(this.total - this.returnedAmount);
    this.remaining = Math.max(round2(net - this.paidAmount), 0);
    this.overpaid = Math.max(round2(this.paidAmount - net), 0);
    if (this.remaining === 0) this.paymentStatus = 'paid';
    else if (this.paidAmount > 0) this.paymentStatus = 'partial';
    else this.paymentStatus = 'unpaid';
  }
}

@Entity('sales_invoice_lines')
@Index(['invoiceId'])
export class SalesInvoiceLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  invoiceId!: string;

  @ManyToOne(() => SalesInvoice, (invoice) => invoice.lines, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'invoiceId' })
  invoice?: SalesInvoice;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  // اسم الصنف وكوده وقت البيع: الفاتورة الصادرة لا تتغير لو عُدّل الصنف لاحقاً
  @Column()
  productName!: string;

  @Column({ type: 'varchar', length: 60 })
  sku!: string;

  /** false = خدمة: لا تخرج من المخزون */
  @Column({ default: true })
  isStocked!: boolean;

  @Column({ type: 'uuid' })
  unitId!: string;

  @ManyToOne(() => Unit, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'unitId' })
  unit?: Unit;

  @Column({ type: 'varchar', length: 60 })
  unitName!: string;

  /** كم وحدة أساس تساوي وحدة البيع — منسوخ وقت الفاتورة */
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 4,
    default: 1,
    transformer: decimalTransformer,
  })
  factor!: number;

  /** بوحدة البيع */
  @Column(quantity)
  quantity!: number;

  /** سعر وحدة البيع كما أُدخل (شامل أو قبل الضريبة حسب الفاتورة) */
  @Column(quantity)
  unitPrice!: number;

  @Column(money)
  discount!: number;

  /** نسبة الضريبة % وتصنيفها لدى الهيئة — منسوخان وقت الفاتورة */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  taxRate!: number;

  @Column({ type: 'varchar', length: 1, default: TaxCategory.STANDARD })
  taxCategory!: string;

  /** قبل الضريبة */
  @Column(money)
  subtotal!: number;

  @Column(money)
  taxAmount!: number;

  @Column(money)
  total!: number;

  /** الكمية بوحدة الأساس (ما يخرج من المخزون) */
  @Column(quantity)
  baseQuantity!: number;

  /** متوسط تكلفة وحدة الأساس وقت الإصدار (تكلفة البضاعة المباعة) */
  @Column({ ...quantity, default: 0 })
  unitCost!: number;

  /** ما أُرجع من هذا السطر (بوحدة البيع) */
  @Column({ ...quantity, default: 0 })
  returnedQuantity!: number;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
