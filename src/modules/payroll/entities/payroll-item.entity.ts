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

  // ===================== المستحقات (Earnings) =====================
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  basicSalary!: number;

  @Column({
    name: 'housing_allowance',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  housingAllowance!: number;

  @Column({
    name: 'transport_allowance',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  transportAllowance!: number;

  @Column({
    name: 'other_allowances',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  otherAllowances!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  overtimeAmount!: number;

  // ✅ إجمالي المكافآت المستحقة هذا الشهر (مصروفة سلفاً + غير مصروفة)
  @Column({
    name: 'bonuses_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  bonusesAmount!: number;

  // ✅ إجمالي التسويات/بدل الإجازات المستحقة هذا الشهر (مصروفة سلفاً + غير مصروفة)
  @Column({
    name: 'settlements_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  settlementsAmount!: number;

  // ✅ إجمالي مكافآت نهاية الخدمة المستحقة هذا الشهر
  @Column({
    name: 'eos_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  eosAmount!: number;

  // ===================== المدفوعات المسبقة (Prepaid — تُخصم لمنع الازدواجية) =====================
  @Column({
    name: 'prepaid_bonuses',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  prepaidBonuses!: number;

  @Column({
    name: 'prepaid_settlements',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  prepaidSettlements!: number;

  // محجوز لأنواع مستقبلية من البدلات/الصرف الاستثنائي المباشر (غير مُفعّل حالياً)
  @Column({
    name: 'prepaid_allowances',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  prepaidAllowances!: number;

  // ===================== الخصومات (Deductions) =====================
  @Column({
    name: 'loan_deduction',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  loanDeduction!: number;

  @Column({
    name: 'advance_deduction',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  advanceDeduction!: number;

  @Column({
    name: 'unpaid_leave_deduction',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  unpaidLeaveDeduction!: number;

  @Column({
    name: 'other_deductions',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  otherDeductions!: number;

  // ===================== الصافي =====================
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  netSalary!: number;

  @Column({ type: 'text', nullable: true })
  notes?: string;
}
