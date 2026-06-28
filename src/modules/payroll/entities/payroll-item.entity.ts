// src/modules/payroll/entities/payroll-item.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';
import { Payroll } from './payroll.entity';

@Entity('payroll_items')
export class PayrollItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'payroll_id' })
  payrollId!: string;

  @ManyToOne(() => Payroll, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payroll_id' })
  payroll!: Payroll;

  @Column({ name: 'employee_id' })
  employeeId!: string;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employee_id' })
  employee!: Employee;

  // الإضافات
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  basicSalary!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  allowances!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  overtimeAmount!: number;

  // الخصومات
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  loanDeduction!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  advanceDeduction!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  unpaidLeaveDeduction!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  otherDeductions!: number;

  // الصافي
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  netSalary!: number;

  @Column({ type: 'text', nullable: true })
  notes?: string;
}
