// src/modules/payroll/entities/payroll.entity.ts
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
