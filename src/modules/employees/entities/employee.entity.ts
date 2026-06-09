// src/modules/employees/entities/employee.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  OneToOne,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';

@Entity('employees')
export class Employee {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 255 })
  fullName!: string;

  // ✅ رقم وظيفي فريد داخل الشركة (أساسي للتكامل مع أجهزة البصمة)
  @Column({ unique: true, length: 50 })
  employeeCode!: string;

  @Column({ nullable: true, length: 20 })
  phone?: string;

  @Column({ nullable: true, length: 100 })
  jobTitle?: string;

  @Column({ nullable: true, length: 100 })
  department?: string;

  @Column({ type: 'date', nullable: true })
  hireDate?: Date;

  @Column({
    type: 'enum',
    enum: ['active', 'inactive', 'terminated'],
    default: 'active',
  })
  status!: 'active' | 'inactive' | 'terminated';

  // ✅ العلاقة الاختيارية مع User
  // إذا كان الموظف لديه حساب دخول، نربطه. وإلا تظل null
  @OneToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date;
}
