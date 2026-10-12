// src/modules/sales/entities/sales-return.entity.ts
import {
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
import { Warehouse } from '../../inventory/entities/warehouse.entity';
import { Customer } from './customer.entity';
import { SalesInvoice, SalesInvoiceLine } from './sales-invoice.entity';

export enum SalesReturnStatus {
  DRAFT = 'draft',
  /** صادر (إشعار دائن): عادت البضاعة للمخزن ونقص ما على العميل. لا يُعدَّل */
  ISSUED = 'issued',
  CANCELLED = 'cancelled',
}

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

/** مرتجع بيع (إشعار دائن): الطريقة الوحيدة لتصحيح فاتورة بيع صادرة */
@Entity('sales_returns')
@Index(['tenantId', 'number'], { unique: true, where: '"number" IS NOT NULL' })
@Index(['tenantId', 'customerId'])
@Index(['tenantId', 'invoiceId'])
export class SalesReturn extends TenantOwnedEntity {
  /** CN-000001 — يُعطى عند الإصدار */
  @Column({ type: 'varchar', length: 30, nullable: true })
  number?: string | null;

  @Column({ type: 'uuid' })
  invoiceId!: string;

  @ManyToOne(() => SalesInvoice, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invoiceId' })
  invoice?: SalesInvoice;

  // العميل والمخزن منسوخان من الفاتورة: كشف الحساب والتقارير لا تحتاج ربطاً
  @Column({ type: 'uuid', nullable: true })
  customerId?: string | null;

  @ManyToOne(() => Customer, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customerId' })
  customer?: Customer | null;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouseId' })
  warehouse?: Warehouse;

  @Column({ type: 'date' })
  returnDate!: string;

  @Column({
    type: 'enum',
    enum: SalesReturnStatus,
    default: SalesReturnStatus.DRAFT,
  })
  status!: SalesReturnStatus;

  @Column(money)
  subtotal!: number;

  @Column(money)
  taxTotal!: number;

  @Column(money)
  total!: number;

  /** ما رُدّ للعميل نقداً عند إصدار المرتجع */
  @Column(money)
  refundedAmount!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason?: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  issuedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  issuedById?: string | null;

  @OneToMany(() => SalesReturnLine, (line) => line.salesReturn)
  lines?: SalesReturnLine[];

  /** ليس عموداً: عدد الأصناف، يُملأ في القائمة */
  linesCount?: number;
}

@Entity('sales_return_lines')
@Index(['returnId', 'invoiceLineId'], { unique: true })
export class SalesReturnLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  returnId!: string;

  @ManyToOne(() => SalesReturn, (ret) => ret.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'returnId' })
  salesReturn?: SalesReturn;

  /** سطر الفاتورة المُرجَع منه: منه السعر والضريبة والتكلفة وحدّ الكمية */
  @Column({ type: 'uuid' })
  invoiceLineId!: string;

  @ManyToOne(() => SalesInvoiceLine, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invoiceLineId' })
  invoiceLine?: SalesInvoiceLine;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  @Column()
  productName!: string;

  @Column({ type: 'varchar', length: 60 })
  unitName!: string;

  /** بوحدة البيع في الفاتورة */
  @Column(quantity)
  quantity!: number;

  /** بوحدة الأساس (ما يعود للمخزون) */
  @Column(quantity)
  baseQuantity!: number;

  @Column(money)
  subtotal!: number;

  @Column(money)
  taxAmount!: number;

  @Column(money)
  total!: number;
}
