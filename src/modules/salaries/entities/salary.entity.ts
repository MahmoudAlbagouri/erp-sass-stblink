// src/modules/salaries/entities/salary.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('salaries')
export class Salary {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'employee_id' })
  employeeId!: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  basicSalary!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  housingAllowance!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  transportAllowance!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  otherAllowances!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  totalSalary!: number;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
