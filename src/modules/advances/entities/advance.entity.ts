import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';
import { User } from '../../users/entities/user.entity';

export enum AdvanceStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PAID = 'paid',
}

@Entity('advances')
export class Advance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount!: number;

  @Column({ type: 'text', nullable: true })
  reason!: string;

  @Column({ type: 'enum', enum: AdvanceStatus, default: AdvanceStatus.PENDING })
  status!: AdvanceStatus;

  // تاريخ السداد المتوقع (يحدد شهر الخصم)
  @Column({ type: 'date' })
  repaymentDate!: Date;

  @Column({ name: 'employee_id' })
  employeeId!: string;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employee_id' })
  employee!: Employee;

  // ===== حقول الصرف الاستثنائي المباشر (Off-Cycle Disbursement) =====
  // ✅ تسجل أن مبلغ السلفة تم تسليمه للموظف فعلياً خارج دورة المسير
  // (مثلاً نقداً أو تحويل مباشر). هذا لا يغيّر خصم السداد الشهري في
  // المسير — السلفة تُخصم دائماً من الراتب حسب repaymentDate بغض
  // النظر عن طريقة صرفها، فهي بطبيعتها مبلغ مُقرَض يُسدَّد لاحقاً.
  @Column({ name: 'is_disbursed', default: false })
  isDisbursed!: boolean;

  @Column({ name: 'disbursed_by_id', nullable: true })
  disbursedById?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'disbursed_by_id' })
  disbursedBy?: User;

  @Column({ name: 'disbursed_at', type: 'timestamptz', nullable: true })
  disbursedAt?: Date;
  // ====================================================================

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
