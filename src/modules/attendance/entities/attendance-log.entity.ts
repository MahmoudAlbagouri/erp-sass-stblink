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
  LEAVE = 'leave', // ✅ جديد — تسجيل إجازة بدل حضور/انصراف
}

export enum VerifyMode {
  FINGERPRINT = 'fingerprint',
  CARD = 'card',
  PASSWORD = 'password',
  FACE = 'face',
  FINGERPRINT_CARD = 'fingerprint_card',
  MANUAL = 'manual', // ✅ جديد — بصمة/سجل تم إدخاله يدويًا من لوحة التحكم
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

  // ✅ وقت البصمة الحالي (قد يكون معدَّلاً يدويًا — القيمة الأصلية محفوظة في originalPunchTime)
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

  // ══════════════ حقول التعديل اليدوي والإضافة اليدوية ══════════════

  // ✅ هل هذا السجل تم إدخاله يدويًا من لوحة التحكم (مش من جهاز البصمة)؟
  @Column({ name: 'is_manual_entry', default: false })
  isManualEntry!: boolean;

  // ✅ بيانات من أضاف السجل يدويًا (لو isManualEntry = true)
  @Column({ name: 'created_by_user_id', nullable: true, type: 'uuid' })
  createdByUserId?: string;

  @Column({ name: 'created_by_name', nullable: true })
  createdByName?: string;

  // ✅ هل تم تعديل وقت هذه البصمة من قبل؟ (يُسمح بمرة واحدة فقط)
  @Column({ name: 'is_edited', default: false })
  isEdited!: boolean;

  @Column({ name: 'edited_by_user_id', nullable: true, type: 'uuid' })
  editedByUserId?: string;

  @Column({ name: 'edited_by_name', nullable: true })
  editedByName?: string;

  @Column({ name: 'edited_at', nullable: true, type: 'timestamptz' })
  editedAt?: Date;

  // ✅ الوقت الأصلي المسجل (من الجهاز أو عند الإضافة اليدوية) — يُستخدم
  // للتحقق من نافذة الـ 24 ساعة المسموح بها للتعديل، حتى بعد تعديل punchTime
  @Column({ name: 'original_punch_time', nullable: true, type: 'timestamptz' })
  originalPunchTime?: Date;

  // ══════════════ حقول الإجازة وساعات العمل ══════════════

  // ✅ سبب الإجازة (مطلوب فقط عندما punchType = LEAVE)
  @Column({ name: 'leave_reason', nullable: true, type: 'text' })
  leaveReason?: string;

  // ✅ عدد ساعات العمل — يُحسب ويُخزَّن على سجل "الانصراف" فقط
  @Column({
    name: 'work_hours',
    nullable: true,
    type: 'decimal',
    precision: 6,
    scale: 2,
  })
  workHours?: number;

  // ✅ ساعات العمل الإضافي (الفرق بين ساعات العمل الفعلية ومدة الشيفت المقررة)
  @Column({
    name: 'overtime_hours',
    nullable: true,
    type: 'decimal',
    precision: 6,
    scale: 2,
  })
  overtimeHours?: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
