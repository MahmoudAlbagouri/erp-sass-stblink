// src/modules/purchasing/entities/supplier-payment.entity.ts
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';
import { PurchaseInvoice } from './purchase-invoice.entity';
import { Supplier } from './supplier.entity';

export enum PaymentMethod {
  CASH = 'cash',
  BANK_TRANSFER = 'bank_transfer',
  CARD = 'card',
  CHEQUE = 'cheque',
}

export enum SupplierPaymentStatus {
  POSTED = 'posted',
  /** أُلغي السداد: يعود المبلغ مستحقاً للمورد، ويبقى السجل للمراجعة */
  CANCELLED = 'cancelled',
}

/** سداد لمورد: على فاتورة محددة، أو دفعة على الحساب */
@Entity('supplier_payments')
@Index(['tenantId', 'number'], { unique: true })
@Index(['tenantId', 'supplierId'])
@Index(['tenantId', 'invoiceId'])
export class SupplierPayment extends TenantOwnedEntity {
  /** SP-000001 */
  @Column({ type: 'varchar', length: 20 })
  number!: string;

  @Column({ type: 'uuid' })
  supplierId!: string;

  @ManyToOne(() => Supplier, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'supplierId' })
  supplier?: Supplier;

  /** null = دفعة على الحساب غير مرتبطة بفاتورة */
  @Column({ type: 'uuid', nullable: true })
  invoiceId?: string | null;

  @ManyToOne(() => PurchaseInvoice, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invoiceId' })
  invoice?: PurchaseInvoice | null;

  @Column({ type: 'date' })
  paymentDate!: string;

  @Column({
    type: 'numeric',
    precision: 15,
    scale: 3,
    transformer: decimalTransformer,
  })
  amount!: number;

  @Column({ type: 'enum', enum: PaymentMethod, default: PaymentMethod.CASH })
  method!: PaymentMethod;

  /** رقم الحوالة / الشيك */
  @Column({ type: 'varchar', length: 80, nullable: true })
  reference?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @Column({
    type: 'enum',
    enum: SupplierPaymentStatus,
    default: SupplierPaymentStatus.POSTED,
  })
  status!: SupplierPaymentStatus;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;
}
