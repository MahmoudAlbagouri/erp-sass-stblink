// src/modules/manufacturing/entities/work-center.entity.ts
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';
import { Branch } from '../../branches/entities/branch.entity';

const rate = {
  type: 'numeric' as const,
  precision: 13,
  scale: 3,
  default: 0,
  transformer: decimalTransformer,
};

/**
 * مركز عمل: ماكينة، خط إنتاج، أو محطة يدوية. منه تُحسب تكلفة الوقت على أمر
 * الإنتاج، وبطاقته يُقاس حمل المصنع (تخطيط الطاقة).
 */
@Entity('work_centers')
@Index(['tenantId', 'code'], { unique: true, where: '"deletedAt" IS NULL' })
@Index(['tenantId', 'name'], { unique: true, where: '"deletedAt" IS NULL' })
export class WorkCenter extends TenantOwnedEntity {
  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /** فرع المصنع (null = الفرع الرئيسي) */
  @Column({ type: 'uuid', nullable: true })
  branchId?: string | null;

  @ManyToOne(() => Branch, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'branchId' })
  branch?: Branch | null;

  /** عدد الماكينات أو العمال المتوازيين في المركز */
  @Column({ type: 'int', default: 1 })
  parallelUnits!: number;

  /** ساعات العمل المتاحة في اليوم (لكل وحدة) — الطاقة */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 8,
    transformer: decimalTransformer,
  })
  hoursPerDay!: number;

  /** أيام العمل: 0 = الأحد … 6 = السبت */
  @Column({ type: 'smallint', array: true, default: () => `'{0,1,2,3,4}'` })
  workingDays!: number[];

  /**
   * الكفاءة % (100 = الوقت القياسي كما هو). كفاءة 80 تجعل الوقت المخطط
   * أطول بربع — تُستعمل في التخطيط لا في التكلفة الفعلية.
   */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 100,
    transformer: decimalTransformer,
  })
  efficiencyPercent!: number;

  /** تكلفة الساعة: عمالة + تشغيل الماكينة */
  @Column(rate)
  costPerHour!: number;

  /** المصاريف غير المباشرة المحمّلة لكل ساعة (كهرباء، إيجار، إهلاك) */
  @Column(rate)
  overheadPerHour!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @Column({ default: true })
  isActive!: boolean;
}
