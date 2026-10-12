// src/modules/purchasing/entities/purchase-invoice.entity.ts
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
import { Unit } from '../../catalog/entities/unit.entity';
import { Warehouse } from '../../inventory/entities/warehouse.entity';
import { Supplier } from './supplier.entity';

export enum PurchaseInvoiceStatus {
  /** مسودة (تصلح كأمر شراء): لا أثر لها على المخزون أو رصيد المورد */
  DRAFT = 'draft',
  /** معتمدة: دخلت البضاعة المخزن وأصبح المبلغ مستحقاً للمورد */
  POSTED = 'posted',
  CANCELLED = 'cancelled',
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

@Entity('purchase_invoices')
@Index(['tenantId', 'number'], { unique: true })
@Index(['tenantId', 'supplierId'])
@Index(['tenantId', 'status', 'invoiceDate'])
export class PurchaseInvoice extends TenantOwnedEntity {
  /** PI-000001 — رقمنا الداخلي */
  @Column({ type: 'varchar', length: 20 })
  number!: string;

  @Column({ type: 'uuid' })
  supplierId!: string;

  @ManyToOne(() => Supplier, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'supplierId' })
  supplier?: Supplier;

  /** المخزن الذي تدخله البضاعة */
  @Column({ type: 'uuid' })
  warehouseId!: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouseId' })
  warehouse?: Warehouse;

  /** رقم فاتورة المورد كما هو مطبوع عليها */
  @Column({ type: 'varchar', length: 60, nullable: true })
  supplierReference?: string | null;

  @Column({ type: 'date' })
  invoiceDate!: string;

  @Column({ type: 'date', nullable: true })
  dueDate?: string | null;

  @Column({
    type: 'enum',
    enum: PurchaseInvoiceStatus,
    default: PurchaseInvoiceStatus.DRAFT,
  })
  status!: PurchaseInvoiceStatus;

  /** الأسعار المُدخلة في الأسطر شاملة الضريبة أم قبلها */
  @Column({ default: false })
  pricesIncludeTax!: boolean;

  /** الإجمالي قبل الضريبة (بعد خصومات الأسطر) */
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

  /** قيمة ما أُرجع للمورد من هذه الفاتورة */
  @Column(money)
  returnedAmount!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  postedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  postedById?: string | null;

  @OneToMany(() => PurchaseInvoiceLine, (line) => line.invoice)
  lines?: PurchaseInvoiceLine[];

  // ─── قيم محسوبة (ليست أعمدة) ───
  /** المتبقي للمورد = الإجمالي − المرتجع − المدفوع */
  remaining?: number;
  paymentStatus?: PaymentStatus;
  linesCount?: number;

  @AfterLoad()
  protected computeDerived(): void {
    const net = round2(this.total - this.returnedAmount);
    this.remaining = Math.max(round2(net - this.paidAmount), 0);
    if (this.remaining === 0) this.paymentStatus = 'paid';
    else if (this.paidAmount > 0) this.paymentStatus = 'partial';
    else this.paymentStatus = 'unpaid';
  }
}

@Entity('purchase_invoice_lines')
@Index(['invoiceId'])
export class PurchaseInvoiceLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  invoiceId!: string;

  @ManyToOne(() => PurchaseInvoice, (invoice) => invoice.lines, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'invoiceId' })
  invoice?: PurchaseInvoice;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  /** وحدة الشراء (الأساس أو وحدة إضافية مثل الكرتون) */
  @Column({ type: 'uuid' })
  unitId!: string;

  @ManyToOne(() => Unit, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'unitId' })
  unit?: Unit;

  /** كم وحدة أساس تساوي وحدة الشراء — منسوخ وقت الفاتورة */
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 4,
    default: 1,
    transformer: decimalTransformer,
  })
  factor!: number;

  /** بوحدة الشراء */
  @Column(quantity)
  quantity!: number;

  /** سعر وحدة الشراء كما أُدخل (شامل أو قبل الضريبة حسب الفاتورة) */
  @Column(quantity)
  unitPrice!: number;

  @Column(money)
  discount!: number;

  /** ضريبة اختيرت يدوياً للسطر. null = ضريبة الصنف */
  @Column({ type: 'uuid', nullable: true })
  taxRateId?: string | null;

  /** نسبة الضريبة % — منسوخة وقت الفاتورة */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  taxRate!: number;

  /** قبل الضريبة */
  @Column(money)
  subtotal!: number;

  @Column(money)
  taxAmount!: number;

  @Column(money)
  total!: number;

  /** الكمية بوحدة الأساس = الكمية × المعامل (ما يدخل المخزون) */
  @Column(quantity)
  baseQuantity!: number;

  /** تكلفة وحدة الأساس قبل الضريبة — تدخل في متوسط التكلفة */
  @Column(quantity)
  unitCost!: number;

  /** ما أُرجع من هذا السطر (بوحدة الشراء) */
  @Column({ ...quantity, default: 0 })
  returnedQuantity!: number;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
