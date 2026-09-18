import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';
import { User } from '../../users/entities/user.entity';

@Entity('settlements')
export class Settlement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'employee_id' })
  employeeId!: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee!: Employee;

  /** عدد أيام الإجازة غير المستخدمة وقت التسوية */
  @Column({ name: 'unused_leave_days', type: 'int' })
  unusedLeaveDays!: number;

  /** أجر اليوم الواحد = totalSalary / 30 */
  @Column({ name: 'daily_rate', type: 'decimal', precision: 12, scale: 2 })
  dailyRate!: number;

  /** إجمالي المبلغ = unusedLeaveDays * dailyRate */
  @Column({ name: 'total_amount', type: 'decimal', precision: 12, scale: 2 })
  totalAmount!: number;

  /** تاريخ إتمام التسوية */
  @Column({ name: 'settlement_date', type: 'date' })
  settlementDate!: Date;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  // ✅ حقول الصرف الجديدة
  @Column({ name: 'is_disbursed', default: false })
  isDisbursed!: boolean;

  @Column({ name: 'disbursed_by_id', nullable: true })
  disbursedById?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'disbursed_by_id' })
  disbursedBy?: User;

  @Column({ name: 'disbursed_at', type: 'timestamptz', nullable: true })
  disbursedAt?: Date;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
