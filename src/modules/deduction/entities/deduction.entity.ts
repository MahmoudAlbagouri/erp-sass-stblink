import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';

@Entity('deductions')
export class Deduction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee!: Employee;

  @Column({ name: 'employee_id' })
  employeeId!: string;

  // اسم أو نوع الخصم (مثال: خصم تأخير، غرامة، استقطاع تأمين)
  @Column({ length: 255 })
  name!: string;

  // إجمالي مبلغ الخصم
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  totalAmount!: number;

  // ✅ تاريخ بدء تطبيق الخصم في المسير
  @Column({ type: 'date' })
  startDate!: Date;

  // ✅ عدد الدفعات (1 = دفعة واحدة، >1 = تقسيط شهري)
  @Column({ default: 1 })
  installmentsCount!: number;

  // المبلغ المستقطع شهرياً (محسوب تلقائياً عند الإنشاء)
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  monthlyAmount!: number;

  // عدد الدفعات التي تم صرفها فعلياً حتى الآن
  @Column({ default: 0 })
  paidInstallments!: number;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
