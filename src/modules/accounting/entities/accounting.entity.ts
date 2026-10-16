// src/modules/accounting/entities/accounting.entity.ts
//
// المحاسبة بالقيد المزدوج: شجرة حسابات لكل شركة، وقيود يومية لا تُعدَّل
// (التصحيح بقيد عكسي)، وإعدادات التفعيل وقفل الفترات. التوثيق:
// docs/modules/accounting.md
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';
import { AccountType } from '../accounting.constants';

const money = {
  type: 'numeric' as const,
  precision: 18,
  scale: 3,
  default: 0,
  transformer: decimalTransformer,
};

/** حساب في الشجرة: تجميعي (أب لغيره، لا يُرحَّل عليه) أو فرعي (عليه القيود) */
@Entity('accounts')
@Index(['tenantId', 'code'], { unique: true, where: '"deletedAt" IS NULL' })
@Index(['tenantId', 'systemKey'], {
  unique: true,
  where: '"systemKey" IS NOT NULL AND "deletedAt" IS NULL',
})
@Index(['tenantId', 'parentId'])
export class Account extends TenantOwnedEntity {
  /** كود متسلسل حسب المستوى: 1 ← 11 ← 1101 ← 110101 */
  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  nameEn?: string | null;

  /** من الحساب الرئيسي في رأس فرعه: لا يتغير بنقل الحساب */
  @Column({ type: 'enum', enum: AccountType })
  type!: AccountType;

  @Column({ type: 'uuid', nullable: true })
  parentId?: string | null;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'parentId' })
  parent?: Account | null;

  /** تجميعي: أب لحسابات، لا يُرحَّل عليه قيد */
  @Column({ default: false })
  isGroup!: boolean;

  /** مفتاح حساب النظام (يرحّل إليه القيد التلقائي) — لا يُحذف ولا يُوقف */
  @Column({ type: 'varchar', length: 40, nullable: true })
  systemKey?: string | null;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ type: 'varchar', length: 300, nullable: true })
  description?: string | null;
}

/** قيد يومية: لا يُعدَّل ولا يُحذف بعد تسجيله — التصحيح بقيد عكسي */
@Entity('journal_entries')
@Index(['tenantId', 'number'], { unique: true })
@Index(['tenantId', 'date'])
@Index(['tenantId', 'sourceType', 'sourceId', 'sourceEvent'], {
  unique: true,
  where: '"sourceId" IS NOT NULL',
})
export class JournalEntry extends TenantOwnedEntity {
  /** JV-000001 */
  @Column({ type: 'varchar', length: 20 })
  number!: string;

  /** التاريخ المحاسبي */
  @Column({ type: 'date' })
  date!: string;

  /**
   * تاريخ المستند إن اختلف عن تاريخ القيد: مستند بتاريخ في فترة مقفلة (أو قبل
   * تفعيل المحاسبة) يُقيَّد في أول يوم مفتوح، ويبقى تاريخه الأصلي هنا
   */
  @Column({ type: 'date', nullable: true })
  documentDate?: string | null;

  @Column({ type: 'varchar', length: 500 })
  description!: string;

  /** JournalSource */
  @Column({ type: 'varchar', length: 30 })
  sourceType!: string;

  /** المستند (null للقيد اليدوي) */
  @Column({ type: 'uuid', nullable: true })
  sourceId?: string | null;

  /**
   * الحدث على المستند (issue، cancel، close…): لكل مستند وحدث قيد واحد —
   * إعادة الترحيل لا تكرره (فهرس فريد)
   */
  @Column({ type: 'varchar', length: 60, nullable: true })
  sourceEvent?: string | null;

  /** رقم المستند للعرض (INV-000012) */
  @Column({ type: 'varchar', length: 40, nullable: true })
  sourceRef?: string | null;

  /** مجموع المدين (= مجموع الدائن) */
  @Column(money)
  total!: number;

  /** هذا القيد يعكس قيداً يدوياً */
  @Column({ type: 'uuid', nullable: true })
  reversalOfId?: string | null;

  /** عُكس هذا القيد بقيد آخر */
  @Column({ type: 'uuid', nullable: true })
  reversedById?: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;

  @OneToMany(() => JournalLine, (line) => line.entry)
  lines?: JournalLine[];
}

/** سطر قيد: طرف واحد (مدين أو دائن) على حساب فرعي */
@Entity('journal_lines')
@Index(['tenantId', 'accountId', 'date'])
@Index(['tenantId', 'partyType', 'partyId'])
@Index(['entryId'])
export class JournalLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  entryId!: string;

  @ManyToOne(() => JournalEntry, (entry) => entry.lines, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'entryId' })
  entry?: JournalEntry;

  @Column({ type: 'int', default: 0 })
  lineOrder!: number;

  @Column({ type: 'uuid' })
  accountId!: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'accountId' })
  account?: Account;

  /** تاريخ القيد (منسوخ للتقارير بلا ربط) */
  @Column({ type: 'date' })
  date!: string;

  @Column(money)
  debit!: number;

  @Column(money)
  credit!: number;

  @Column({ type: 'varchar', length: 300, nullable: true })
  description?: string | null;

  /** مركز التكلفة: الفرع */
  @Column({ type: 'uuid', nullable: true })
  branchId?: string | null;

  /** الطرف (الدفتر المساعد): عميل، مورد، موظف، جهة توصيل */
  @Column({ type: 'varchar', length: 20, nullable: true })
  partyType?: string | null;

  @Column({ type: 'uuid', nullable: true })
  partyId?: string | null;
}

/** إعدادات المحاسبة: صف واحد لكل شركة، يُنشأ عند تفعيلها */
@Entity('accounting_settings')
export class AccountingSettings {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  /**
   * لحظة التفعيل: كل مستند بعدها يُرحَّل تلقائياً، وما قبلها دخل في القيد
   * الافتتاحي (أرصدة العملاء والموردين والمخزون في تلك اللحظة)
   */
  @Column({ type: 'timestamptz' })
  activatedAt!: Date;

  /** أول يوم في الدفاتر: تاريخ القيد الافتتاحي ولا قيد قبله */
  @Column({ type: 'date' })
  startDate!: string;

  /** الفترة مقفلة حتى هذا اليوم (شاملاً): لا قيد بتاريخه أو قبله */
  @Column({ type: 'date', nullable: true })
  lockDate?: string | null;

  /** دولة الشجرة الجاهزة التي أُنشئت منها الشجرة */
  @Column({ type: 'varchar', length: 2 })
  chartCountry!: string;

  /** طريقة القبض ← معرّف الحساب (ما لم يُحدَّد: حساب النظام الافتراضي) */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  receiptAccounts!: Record<string, string>;

  /** طريقة الدفع ← معرّف الحساب */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  paymentAccounts!: Record<string, string>;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  activatedById?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * مستند تعذّر ترحيله (حساب موقوف، بيانات ناقصة…). لا يوقف البيع ولا
 * المستند نفسه: يظهر للمحاسب بسببه، ويُعاد ترحيله مع كل دورة حتى ينجح.
 */
@Entity('accounting_posting_errors')
@Index(['tenantId', 'sourceType', 'sourceId', 'sourceEvent'], {
  unique: true,
})
export class PostingError {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'varchar', length: 30 })
  sourceType!: string;

  @Column({ type: 'uuid' })
  sourceId!: string;

  @Column({ type: 'varchar', length: 60 })
  sourceEvent!: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  sourceRef?: string | null;

  @Column({ type: 'varchar', length: 500 })
  message!: string;

  @Column({ type: 'int', default: 1 })
  attempts!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  firstSeenAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  lastSeenAt!: Date;
}

/**
 * مستند مرّ عليه محرك الترحيل فلم يجد له أثراً محاسبياً (مبالغه صفر):
 * يُعلَّم هنا فلا يُعاد فحصه في كل دورة.
 */
@Entity('accounting_skipped_sources')
export class SkippedSource {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ type: 'varchar', length: 30 })
  sourceType!: string;

  @PrimaryColumn({ type: 'uuid' })
  sourceId!: string;

  @PrimaryColumn({ type: 'varchar', length: 60 })
  sourceEvent!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/**
 * الرصيد الافتتاحي للعميل/المورد لحظة تفعيل المحاسبة (دخل في القيد
 * الافتتاحي). تعديله بعدها يُرحَّل فرقه: الحالي − هذا − ما رُحّل من فروق.
 */
@Entity('accounting_opening_baselines')
export class OpeningBaseline {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  @PrimaryColumn({ type: 'varchar', length: 20 })
  partyType!: string;

  @PrimaryColumn({ type: 'uuid' })
  partyId!: string;

  @Column(money)
  amount!: number;
}
