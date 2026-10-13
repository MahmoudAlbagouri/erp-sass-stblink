// src/modules/sales/entities/customer-payment.entity.ts
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';
import { Customer } from './customer.entity';
import { SalesInvoice } from './sales-invoice.entity';

export enum SalesPaymentMethod {
  CASH = 'cash',
  CARD = 'card',
  BANK_TRANSFER = 'bank_transfer',
  CHEQUE = 'cheque',
}

export enum PaymentDirection {
  /** قبض من العميل */
  IN = 'in',
  /** ردّ للعميل (عند مرتجع بيع) */
  OUT = 'out',
}

export enum CustomerPaymentStatus {
  POSTED = 'posted',
  /** أُلغي: يعود المبلغ على العميل، ويبقى السجل للمراجعة */
  CANCELLED = 'cancelled',
}

/**
 * حركة نقدية مع عميل: قبض على فاتورة، دفعة على الحساب، أو ردّ مبلغ عند
 * مرتجع. فاتورة البيع النقدي لعميل عابر تُقبض بحركة بلا customerId.
 */
@Entity('customer_payments')
@Index(['tenantId', 'number'], { unique: true })
@Index(['tenantId', 'customerId'])
@Index(['tenantId', 'invoiceId'])
@Index(['tenantId', 'paymentDate'])
@Index(['tenantId', 'branchId'])
export class CustomerPayment extends TenantOwnedEntity {
  /**
   * الفرع الذي قبض (أو ردّ) المبلغ: فرع الفاتورة إن وُجدت، وإلا ما اختاره
   * المستخدم، وإلا الفرع الرئيسي.
   */
  @Column({ type: 'uuid', nullable: true })
  branchId?: string | null;

  /** RC-000001 */
  @Column({ type: 'varchar', length: 20 })
  number!: string;

  @Column({ type: 'uuid', nullable: true })
  customerId?: string | null;

  @ManyToOne(() => Customer, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customerId' })
  customer?: Customer | null;

  /** null = دفعة على الحساب غير مرتبطة بفاتورة */
  @Column({ type: 'uuid', nullable: true })
  invoiceId?: string | null;

  @ManyToOne(() => SalesInvoice, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invoiceId' })
  invoice?: SalesInvoice | null;

  /** مرتجع البيع الذي نتج عنه هذا الردّ (للحركات الخارجة) */
  @Column({ type: 'uuid', nullable: true })
  salesReturnId?: string | null;

  @Column({
    type: 'enum',
    enum: PaymentDirection,
    default: PaymentDirection.IN,
  })
  direction!: PaymentDirection;

  @Column({ type: 'date' })
  paymentDate!: string;

  /** دائماً موجب — الاتجاه يحدد قبضاً أم ردّاً */
  @Column({
    type: 'numeric',
    precision: 15,
    scale: 3,
    transformer: decimalTransformer,
  })
  amount!: number;

  @Column({
    type: 'enum',
    enum: SalesPaymentMethod,
    default: SalesPaymentMethod.CASH,
  })
  method!: SalesPaymentMethod;

  /** رقم عملية الشبكة / الحوالة / الشيك */
  @Column({ type: 'varchar', length: 80, nullable: true })
  reference?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @Column({
    type: 'enum',
    enum: CustomerPaymentStatus,
    default: CustomerPaymentStatus.POSTED,
  })
  status!: CustomerPaymentStatus;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;
}
