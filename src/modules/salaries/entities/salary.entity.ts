// src/modules/salaries/entities/salary.entity.ts
import { Employee } from 'src/modules/employees/entities/employee.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
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
  @ManyToOne(() => Employee, (employee) => employee.id) // أو employee.salaries إذا عرفتها في Employee
  @JoinColumn({ name: 'employee_id' })
  employee?: Employee;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
