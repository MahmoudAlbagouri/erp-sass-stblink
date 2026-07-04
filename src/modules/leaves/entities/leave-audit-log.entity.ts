// src/modules/leaves/entities/leave-audit-log.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { LeaveRequest, LeaveStatus } from './leave-request.entity';
import { Employee } from '../../employees/entities/employee.entity';

export enum LeaveAuditActionType {
  STATUS_CHANGE = 'STATUS_CHANGE',
  CREATED = 'CREATED',
  DELETED = 'DELETED',
}

@Entity('leave_audit_logs')
@Index(['leaveRequestId']) // فهرس أساسي: جلب سجل طلب محدد بسرعة
@Index(['leaveRequestId', 'timestamp']) // ✅ لعرض السجل مرتباً زمنياً دون فرز إضافي
@Index(['tenantId', 'timestamp']) // ✅ لتقارير الأدمن حسب المؤسسة
export class LeaveAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'leave_request_id' })
  leaveRequestId!: string;

  @ManyToOne(() => LeaveRequest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'leave_request_id' })
  leaveRequest!: LeaveRequest;

  /** الموظف/المستخدم الذي قام بالتغيير (قد يكون Admin أو System) */
  @Column({ name: 'changed_by_id', nullable: true })
  changedById?: string;

  @ManyToOne(() => Employee, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'changed_by_id' })
  changedBy?: Employee;

  @Column({
    name: 'old_status',
    type: 'enum',
    enum: LeaveStatus,
    nullable: true, // null في حالة "إنشاء" الطلب لأول مرة
  })
  oldStatus?: LeaveStatus;

  @Column({ name: 'new_status', type: 'enum', enum: LeaveStatus })
  newStatus!: LeaveStatus;

  @Column({
    name: 'action_type',
    type: 'enum',
    enum: LeaveAuditActionType,
    default: LeaveAuditActionType.STATUS_CHANGE,
  })
  actionType!: LeaveAuditActionType;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @CreateDateColumn({ name: 'timestamp' })
  timestamp!: Date;
}
