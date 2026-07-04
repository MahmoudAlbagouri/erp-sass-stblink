// src/modules/leaves/entities/leave-balance.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';

@Entity('leave_balances')
@Index(['employeeId', 'year'], { unique: true }) // لمنع تكرار السنة للموظف الواحد
@Index(['tenantId', 'year']) // ✅ جديد: تسريع تقارير/استعلامات الأدمن حسب المؤسسة والسنة
export class LeaveBalance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'employee_id' })
  employeeId!: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee!: Employee;

  @Column()
  year!: number;

  /** السقف السنوي للاستحقاق (annualLeaveDays من العقد) */
  @Column({ type: 'int', default: 30 })
  totalAllowance!: number;

  @Column({ type: 'int', default: 0 })
  consumedDays!: number;

  /**
   * تاريخ بدء حساب الاستحقاق اليومي.
   * القيمة الابتدائية = تاريخ التعيين (من العقد).
   * تتحدّث تلقائياً إلى تاريخ التسوية بعد كل عملية Settlement كاملة،
   * وإلى تاريخ الذكرى السنوية بعد كل عملية ترحيل رصيد (Carry-over).
   * (لا تتحدّث في حالة التسوية الجزئية — تبقى الدورة مستمرة).
   */
  @Column({ name: 'accrual_start_date', type: 'date', nullable: true })
  accrualStartDate?: Date;

  /** رصيد مرحّل من سنة سابقة (يُضاف إلى الرصيد المكتسب الحالي)، مُقيّد بسقف maxCarryOverDays */
  @Column({
    name: 'carried_over_days',
    type: 'decimal',
    precision: 10,
    scale: 3,
    default: 0,
  })
  carriedOverDays!: number;

  @Column({ name: 'tenant_id' })
  tenantId!: string;
}
