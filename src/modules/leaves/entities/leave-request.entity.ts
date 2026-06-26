// src/modules/leaves/entities/leave-request.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';

export enum LeaveStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum LeaveType {
  ANNUAL = 'annual',
  UNPAID = 'unpaid',
  OTHER = 'other',
}

@Entity('leave_requests')
export class LeaveRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  employeeId!: string;

  // ✅ التصحيح: استخدام نفس اسم العمود الموجود في قاعدة البيانات
  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employeeId' })
  employee!: Employee;

  @Column({ type: 'date' })
  startDate!: Date;

  @Column({ type: 'date' })
  endDate!: Date;

  @Column({ type: 'enum', enum: LeaveType, default: LeaveType.ANNUAL })
  type!: LeaveType;

  @Column({ type: 'enum', enum: LeaveStatus, default: LeaveStatus.PENDING })
  status!: LeaveStatus;

  @Column({ type: 'text', nullable: true })
  reason?: string;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
