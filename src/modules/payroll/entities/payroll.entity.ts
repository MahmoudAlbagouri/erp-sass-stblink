import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  OneToMany,
  CreateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { PayrollItem } from './payroll-item.entity';
import { User } from '../../users/entities/user.entity'; // ✅ تأكد من الاستيراد

@Entity('payrolls')
export class Payroll {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  month!: number;

  @Column({ type: 'int' })
  year!: number;

  @Column({ type: 'decimal', precision: 14, scale: 2, default: 0 })
  totalNetSalary!: number;

  @Column({ type: 'date' })
  paymentDate!: Date;

  // ✅ حقول الصرف (تأكد من أسماء الأعمدة مطابقة لقاعدة البيانات)
  @Column({ name: 'is_disbursed', default: false })
  isDisbursed!: boolean;

  @Column({ name: 'disbursed_by_id', nullable: true })
  disbursedById?: string;

  // ✅ العلاقة مع المستخدم
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'disbursed_by_id' })
  disbursedBy?: User;

  @Column({ name: 'disbursed_at', type: 'timestamptz', nullable: true })
  disbursedAt?: Date;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  @OneToMany(() => PayrollItem, (item) => item.payroll)
  items!: PayrollItem[];

  @CreateDateColumn()
  generatedAt!: Date;
}
