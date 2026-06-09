// src/modules/tenants/entities/tenant.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn, // مهم للـ Soft Delete
} from 'typeorm';
import {
  TenantStatus,
  SubscriptionPlan,
} from '../../../common/enums/tenant.enums';

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // --- بيانات الهوية ---
  @Column({ unique: true })
  company_name!: string;

  @Column({ nullable: true })
  logo_url?: string; // رابط شعار الشركة

  @Column({ nullable: true })
  domain?: string; // نطاق مخصص للشركة (اختياري)

  // --- بيانات التواصل ---
  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  address?: string;

  @Column({ nullable: true })
  country?: string;

  // --- حالة الاشتراك والخطة ---
  @Column({
    type: 'enum',
    enum: SubscriptionPlan,
    default: SubscriptionPlan.FREE,
  })
  subscription_plan!: SubscriptionPlan;

  @Column({ type: 'enum', enum: TenantStatus, default: TenantStatus.TRIAL })
  status!: TenantStatus;

  @Column({ nullable: true })
  trial_ends_at?: Date; // تاريخ انتهاء الفترة التجريبية

  @Column({ nullable: true })
  subscription_ends_at?: Date; // تاريخ انتهاء الاشتراك المدفوع

  // --- حدود الاستخدام (Quotas) ---
  @Column({ default: 5 })
  max_users!: number; // الحد الأقصى للمستخدمين حسب الخطة

  @Column({ default: 1000 })
  storage_limit_mb!: number; // مساحة التخزين بالميجابايت

  // --- إعدادات النظام ---
  @Column({ default: 'ar' })
  language?: string; // اللغة الافتراضية للشركة

  @Column({ default: 'UTC+3' })
  timezone?: string; // المنطقة الزمنية

  @Column({ default: false })
  is_verified?: boolean; // هل تم التحقق من البريد الإلكتروني؟

  // --- التواريخ ---
  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @DeleteDateColumn({ nullable: true })
  deleted_at?: Date; // للحذف الناعم (Soft Delete) بدلاً من الحذف النهائي
}
