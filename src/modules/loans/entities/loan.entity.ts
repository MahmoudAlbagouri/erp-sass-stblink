// src/modules/loans/entities/loan.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';

export enum LoanStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
}

@Entity('loans')
export class Loan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  totalAmount!: number;

  @Column()
  installmentsCount!: number; // عدد الأقساط

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  monthlyInstallment!: number; // قيمة القسط الشهري (محسوبة تلقائياً)

  @Column({ type: 'text', nullable: true })
  reason?: string; // سبب القرض (اختياري)

  @Column({ type: 'enum', enum: LoanStatus, default: LoanStatus.PENDING })
  status!: LoanStatus;

  // تاريخ بداية السداد (متى يتم خصم أول قسط)
  @Column({ type: 'date' })
  startDate!: Date;

  @Column({ name: 'employee_id' })
  employeeId!: string;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employee_id' })
  employee!: Employee;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
