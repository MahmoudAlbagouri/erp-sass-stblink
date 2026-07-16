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

export enum ResignationStatus {
  PENDING = 'pending', // بانتظار موافقة المدير المباشر
  APPROVED = 'approved', // تمت الموافقة (جاهز لإنهاء الخدمة)
  REJECTED = 'rejected', // تم الرفض
  CANCELLED = 'cancelled', // ألغاه الموظف بنفسه
}

@Entity('resignation_requests')
export class ResignationRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee!: Employee;

  @Column({ name: 'employee_id' })
  employeeId!: string;

  // تاريخ تقديم الطلب
  @Column({ type: 'date' })
  requestDate!: Date;

  // التاريخ المقترح لآخر يوم عمل
  @Column({ type: 'date' })
  lastWorkingDay!: Date;

  @Column({ type: 'text' })
  reason!: string;

  @Column({
    type: 'enum',
    enum: ResignationStatus,
    default: ResignationStatus.PENDING,
  })
  status!: ResignationStatus;

  // ملاحظات الرفض أو الموافقة من المدير
  @Column({ type: 'text', nullable: true })
  managerNotes?: string;

  // تاريخ اتخاذ القرار
  @Column({ type: 'timestamptz', nullable: true })
  decisionDate?: Date;

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
