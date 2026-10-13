// src/modules/purchasing/entities/purchase-return.entity.ts
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
import { Unit } from '../../catalog/entities/unit.entity';
import { Warehouse } from '../../inventory/entities/warehouse.entity';
import {
  PurchaseInvoice,
  PurchaseInvoiceLine,
} from './purchase-invoice.entity';
import { Supplier } from './supplier.entity';

export enum PurchaseReturnStatus {
  DRAFT = 'draft',
  /** معتمد: خرجت البضاعة من المخزن ونقص المستحق للمورد */
  POSTED = 'posted',
  CANCELLED = 'cancelled',
}

const money = {
  type: 'numeric' as const,
  precision: 15,
  scale: 3,
  default: 0,
  transformer: decimalTransformer,
};

const quantity = {
  type: 'numeric' as const,
  precision: 14,
  scale: 4,
  transformer: decimalTransformer,
};

/** مرتجع شراء: إعادة بضاعة من فاتورة شراء معتمدة إلى المورد */
@Entity('purchase_returns')
@Index(['tenantId', 'number'], { unique: true })
@Index(['tenantId', 'supplierId'])
@Index(['tenantId', 'invoiceId'])
export class PurchaseReturn extends TenantOwnedEntity {
  /** PR-000001 */
  @Column({ type: 'varchar', length: 20 })
  number!: string;

  @Column({ type: 'uuid' })
  invoiceId!: string;

  @ManyToOne(() => PurchaseInvoice, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invoiceId' })
  invoice?: PurchaseInvoice;

  // المورد والمخزن منسوخان من الفاتورة: كشف الحساب والتقارير لا تحتاج ربطاً
  @Column({ type: 'uuid' })
  supplierId!: string;

  @ManyToOne(() => Supplier, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'supplierId' })
  supplier?: Supplier;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouseId' })
  warehouse?: Warehouse;

  @Column({ type: 'date' })
  returnDate!: string;

  @Column({
    type: 'enum',
    enum: PurchaseReturnStatus,
    default: PurchaseReturnStatus.DRAFT,
  })
  status!: PurchaseReturnStatus;

  @Column(money)
  subtotal!: number;

  @Column(money)
  taxTotal!: number;

  @Column(money)
  total!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason?: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  postedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  postedById?: string | null;

  @OneToMany(() => PurchaseReturnLine, (line) => line.purchaseReturn)
  lines?: PurchaseReturnLine[];

  /** ليس عموداً: عدد الأصناف، يُملأ في القائمة */
  linesCount?: number;
}

@Entity('purchase_return_lines')
@Index(['returnId', 'invoiceLineId'], { unique: true })
export class PurchaseReturnLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  returnId!: string;

  @ManyToOne(() => PurchaseReturn, (ret) => ret.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'returnId' })
  purchaseReturn?: PurchaseReturn;

  /** سطر الفاتورة المُرجَع منه: منه السعر والضريبة وحدّ الكمية */
  @Column({ type: 'uuid' })
  invoiceLineId!: string;

  @ManyToOne(() => PurchaseInvoiceLine, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invoiceLineId' })
  invoiceLine?: PurchaseInvoiceLine;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  @Column({ type: 'uuid' })
  unitId!: string;

  @ManyToOne(() => Unit, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'unitId' })
  unit?: Unit;

  /** بوحدة الشراء في الفاتورة */
  @Column(quantity)
  quantity!: number;

  /** بوحدة الأساس (ما يخرج من المخزون) */
  @Column(quantity)
  baseQuantity!: number;

  @Column(money)
  subtotal!: number;

  @Column(money)
  taxAmount!: number;

  @Column(money)
  total!: number;
}
