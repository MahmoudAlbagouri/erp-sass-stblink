// src/modules/leaves/entities/leave-balance-history.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum LeaveBalanceAction {
  ACCRUAL = 'ACCRUAL',
  CONSUMPTION = 'CONSUMPTION',
  CARRY_OVER = 'CARRY_OVER',
  SETTLEMENT = 'SETTLEMENT',
  ADJUSTMENT = 'ADJUSTMENT',
}

@Entity('leave_balance_history')
@Index(['employeeId', 'tenantId']) // ✅ تحسين أداء الاستعلامات الشائعة على سجل التدقيق
@Index(['employeeId', 'tenantId', 'action', 'cycleYear']) // ✅ فحص سريع لـ "هل هذه الدورة معالجة؟"
export class LeaveBalanceHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'employee_id' })
  employeeId!: string;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'enum', enum: LeaveBalanceAction })
  action!: LeaveBalanceAction;

  /** موجب = إضافة رصيد (استحقاق/ترحيل) — سالب = خصم رصيد (استهلاك/تسوية) */
  @Column({ name: 'days_change', type: 'decimal', precision: 10, scale: 3 })
  daysChange!: number;

  /** الرصيد المتاح بعد تنفيذ هذه الحركة */
  @Column({ name: 'balance_after', type: 'decimal', precision: 10, scale: 3 })
  balanceAfter!: number;

  /** معرّف مرجعي اختياري (settlement id / leave request id) */
  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId?: string;

  /**
   * ✅ عمود جديد: السنة/الدورة التي تنتمي إليها هذه الحركة.
   * يُستخدم كمفتاح Idempotency لمنع الـ Cron أو الـ Settlement من معالجة
   * نفس دورة الترحيل أو التسوية مرتين — أساسي لدعم الـ Backfilling الآمن.
   *
   * ⚠️ هذا عمود جديد يتطلب migration (أو synchronize في بيئة التطوير)،
   * فهو ليس تعديلاً على منطق الخدمة فقط.
   */
  @Column({ name: 'cycle_year', type: 'int', nullable: true })
  cycleYear?: number;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
