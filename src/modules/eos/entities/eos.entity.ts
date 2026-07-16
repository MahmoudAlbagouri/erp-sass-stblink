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

export enum EOSReason {
  RESIGNATION = 'استقالة',
  TERMINATION = 'فسخ عقد',
  CONTRACT_END = 'انتهاء عقد',
  RETIREMENT = 'تقاعد',
  OTHER = 'أخرى',
}

@Entity('end_of_service')
export class EndOfService {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee!: Employee;

  @Column({ name: 'employee_id' })
  employeeId!: string;

  // تاريخ انتهاء العلاقة العمالية الفعلي
  @Column({ type: 'date' })
  terminationDate!: Date;

  // سبب إنهاء الخدمة (يحدد نسبة الاستحقاق قانونياً)
  @Column({ type: 'enum', enum: EOSReason })
  reason!: EOSReason;

  // عدد سنوات الخدمة المحسوبة فعلياً
  @Column({ type: 'decimal', precision: 10, scale: 3 })
  serviceYears!: number;

  // ✅ مكافأة نهاية الخدمة فقط (بدون بدل إجازات)
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  eosAmount!: number;

  // الراتب الأساسي الأخير المستخدم في الحساب
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  lastBasicSalary!: number;

  // ✅ تاريخ صرف المكافأة فعلياً (لربطه بمسير الرواتب)
  @Column({ type: 'date' })
  payoutDate!: Date;

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
