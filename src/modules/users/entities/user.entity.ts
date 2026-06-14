// src/modules/users/entities/user.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToOne,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Role } from '../../roles/entities/role.entity';
import { UserStatus } from '../../../common/enums/user.enums';
import { Employee } from 'src/modules/employees/entities/employee.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  username!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ select: false })
  password!: string;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status!: UserStatus;

  @Column({ default: false })
  isSuperAdmin!: boolean; // مدير الشركة (Tenant Admin)

  @Column({ default: false })
  isSystemAdmin!: boolean; // مالك المنصة (Platform Owner)

  @Column({ default: false })
  isEmailVerified!: boolean;

  // ✅ nullable: true لأن مالك النظام قد لا يكون مرتبطاً بشركة
  @Column({ name: 'tenant_id', nullable: true })
  tenantId?: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  @OneToOne(() => Employee, (employee) => employee.user)
  employee?: Employee;

  @Column({ name: 'role_id', nullable: true })
  roleId?: string;

  @ManyToOne(() => Role, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'role_id' })
  role?: Role;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @DeleteDateColumn({ nullable: true })
  deleted_at?: Date;
}
