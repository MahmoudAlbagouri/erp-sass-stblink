// src/modules/attendance/entities/attendance-settings.entity.ts
import {
  Entity,
  PrimaryColumn,
  Column,
  OneToOne,
  JoinColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

/**
 * سياسة الحضور للشركة: صف واحد لكل شركة، يُنشأ عند أول حفظ (قبله تسري القيم
 * الافتراضية — انظر AttendanceSettingsService.defaults).
 */
@Entity('attendance_settings')
export class AttendanceSettings {
  @PrimaryColumn({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @OneToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  /** أيام الراحة الأسبوعية (0 = الأحد … 6 = السبت)، ما لم تحدد الوردية غيرها */
  @Column({ name: 'weekly_off_days', type: 'smallint', array: true })
  weeklyOffDays!: number[];

  /** يخصم المسير أيام الغياب (بأجر اليوم) */
  @Column({ name: 'deduct_absence', default: false })
  deductAbsence!: boolean;

  /** يخصم المسير دقائق التأخير والانصراف المبكر (بأجر الدقيقة) */
  @Column({ name: 'deduct_lateness', default: false })
  deductLateness!: boolean;

  /** يضيف المسير أجر الساعات الإضافية */
  @Column({ name: 'pay_overtime', default: false })
  payOvertime!: boolean;

  /** أجر الساعة الإضافية نسبةً من أجر الساعة العادية (150 = مرة ونصف) */
  @Column({ name: 'overtime_rate_percent', type: 'smallint', default: 150 })
  overtimeRatePercent!: number;

  /** إضافي اليوم أقل من هذا لا يُحتسب (دقائق) */
  @Column({ name: 'overtime_min_minutes', type: 'smallint', default: 30 })
  overtimeMinMinutes!: number;

  /**
   * نسخ بصمات الأصابع والوجه بين أجهزة الشركة (ZKTeco): تُحفظ مشفّرة على
   * السيرفر لتُرسل لباقي الأجهزة — فيسجّل الموظف بصمته مرة واحدة.
   */
  @Column({ name: 'sync_biometrics', default: false })
  syncBiometrics!: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
