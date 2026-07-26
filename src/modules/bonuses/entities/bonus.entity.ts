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

// ✅ تعريف حالات المكافأة
export enum BonusStatus {
  PENDING = 'pending', // معلقة
  APPROVED = 'approved', // موافق عليها
  REJECTED = 'rejected', // مرفوضة
  PAID = 'paid', // تم الصرف (اختياري للمستقبل)
}

@Entity('bonuses')
export class Bonus {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee!: Employee;

  @Column({ name: 'employee_id' })
  employeeId!: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount!: number;

  // ✅ هذا التاريخ هو الذي يحدد انتماء المكافأة لمسير رواتب معين
  @Column({ type: 'date' })
  payoutDate!: Date;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  // ✅ حقل الحالة مع قيمة افتراضية "معلقة"
  @Column({
    type: 'enum',
    enum: BonusStatus,
    default: BonusStatus.PENDING,
  })
  status!: BonusStatus;

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
