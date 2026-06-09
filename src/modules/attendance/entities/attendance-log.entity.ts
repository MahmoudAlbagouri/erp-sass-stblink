// src/modules/attendance/entities/attendance-log.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Employee } from '../../employees/entities/employee.entity';
import { BiometricDevice } from './biometric-device.entity';

export enum PunchType {
  CHECK_IN = 'check_in',
  CHECK_OUT = 'check_out',
  BREAK_OUT = 'break_out',
  BREAK_IN = 'break_in',
  OVERTIME_IN = 'overtime_in',
  OVERTIME_OUT = 'overtime_out',
}

export enum VerifyMode {
  FINGERPRINT = 'fingerprint',
  CARD = 'card',
  PASSWORD = 'password',
  FACE = 'face',
  FINGERPRINT_CARD = 'fingerprint_card',
}

@Entity('attendance_logs')
@Index(['tenantId', 'punchTime'])
@Index(['employeeId', 'punchTime'])
export class AttendanceLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ✅ الـ PIN بتاع الموظف على الجهاز (مش UUID)
  @Column({ name: 'device_user_id' })
  deviceUserId!: string;

  @Column({ name: 'employee_id', nullable: true, type: 'uuid' })
  employeeId?: string;

  @ManyToOne(() => Employee, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'employee_id' })
  employee?: Employee;

  @Column({ name: 'device_id', nullable: true, type: 'uuid' })
  deviceId?: string;

  @ManyToOne(() => BiometricDevice, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'device_id' })
  device?: BiometricDevice;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  // ✅ وقت البصمة الفعلي المُرسَل من الجهاز
  @Column({ name: 'punch_time', type: 'timestamptz' })
  punchTime!: Date;

  @Column({
    name: 'punch_type',
    type: 'enum',
    enum: PunchType,
    default: PunchType.CHECK_IN,
  })
  punchType!: PunchType;

  @Column({
    name: 'verify_mode',
    type: 'enum',
    enum: VerifyMode,
    default: VerifyMode.FINGERPRINT,
  })
  verifyMode!: VerifyMode;

  // ✅ معرف الجهاز الفيزيائي (SN من ZKTeco)
  @Column({ name: 'device_sn', nullable: true })
  deviceSn?: string;

  // ✅ منع تكرار نفس السجل من نفس الجهاز
  @Column({ name: 'raw_log_id', nullable: true })
  rawLogId?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
