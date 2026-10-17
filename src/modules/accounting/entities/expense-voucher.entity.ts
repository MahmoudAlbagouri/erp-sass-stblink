// src/modules/accounting/entities/expense-voucher.entity.ts
//
// سند الصرف: مصروف (إيجار، كهرباء، صيانة…) يُدفع من صندوق أو بنك. يُقيَّد فور
// حفظه، ولا يُعدَّل — يُلغى بقيد عكسي بتاريخ إلغائه.
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
import { Account } from './accounting.entity';

const money = {
  type: 'numeric' as const,
  precision: 18,
  scale: 3,
  default: 0,
  transformer: decimalTransformer,
};

export enum ExpenseVoucherStatus {
  /** قُيِّد */
  POSTED = 'posted',
  /** أُلغي بقيد عكسي (يبقى للمراجعة) */
  CANCELLED = 'cancelled',
}

@Entity('expense_vouchers')
@Index(['tenantId', 'number'], { unique: true })
@Index(['tenantId', 'date'])
export class ExpenseVoucher extends TenantOwnedEntity {
  /** PV-000001 */
  @Column({ type: 'varchar', length: 20 })
  number!: string;

  @Column({ type: 'date' })
  date!: string;

  /** الصندوق أو البنك الذي دُفع منه */
  @Column({ type: 'uuid' })
  paidFromAccountId!: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'paidFromAccountId' })
  paidFromAccount?: Account;

  /** المستفيد (مؤجر، شركة كهرباء، فني…) */
  @Column({ type: 'varchar', length: 150 })
  payee!: string;

  /** الرقم الضريبي للمستفيد (لإقرار الضريبة) */
  @Column({ type: 'varchar', length: 30, nullable: true })
  payeeTaxNumber?: string | null;

  /** رقم فاتورة المستفيد أو الإيصال */
  @Column({ type: 'varchar', length: 80, nullable: true })
  reference?: string | null;

  @Column({ type: 'varchar', length: 500 })
  description!: string;

  @Column({
    type: 'enum',
    enum: ExpenseVoucherStatus,
    default: ExpenseVoucherStatus.POSTED,
  })
  status!: ExpenseVoucherStatus;

  /** قبل الضريبة */
  @Column(money)
  subtotal!: number;

  @Column(money)
  taxTotal!: number;

  @Column(money)
  total!: number;

  /**
   * الضريبة مستردة (المنشأة مسجّلة في الضريبة وقت الصرف): إلى ضريبة المدخلات
   * وتدخل الإقرار. غير المسجّلة: الضريبة جزء من المصروف.
   */
  @Column({ default: false })
  taxRecoverable!: boolean;

  @Column({ type: 'uuid', nullable: true })
  journalEntryId?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt?: Date | null;

  /** تاريخ قيد الإلغاء (يدخل إقرار الضريبة لفترته تعديلاً) */
  @Column({ type: 'date', nullable: true })
  cancelDate?: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  cancelReason?: string | null;

  @Column({ type: 'uuid', nullable: true })
  cancelJournalEntryId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;

  @OneToMany(() => ExpenseVoucherLine, (line) => line.voucher)
  lines?: ExpenseVoucherLine[];
}

@Entity('expense_voucher_lines')
@Index(['voucherId'])
export class ExpenseVoucherLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  voucherId!: string;

  @ManyToOne(() => ExpenseVoucher, (voucher) => voucher.lines, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'voucherId' })
  voucher?: ExpenseVoucher;

  @Column({ type: 'int', default: 0 })
  lineOrder!: number;

  /** حساب المصروف (أو أي حساب فرعي يُصرف عليه) */
  @Column({ type: 'uuid' })
  accountId!: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'accountId' })
  account?: Account;

  @Column({ type: 'varchar', length: 300, nullable: true })
  description?: string | null;

  /** المبلغ قبل الضريبة */
  @Column(money)
  amount!: number;

  /** نسبة الضريبة % (صفر = بلا ضريبة) */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  taxRate!: number;

  @Column(money)
  taxAmount!: number;

  @Column(money)
  total!: number;

  /** مركز التكلفة */
  @Column({ type: 'uuid', nullable: true })
  branchId?: string | null;
}
