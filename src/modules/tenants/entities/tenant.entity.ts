// src/modules/tenants/entities/tenant.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany, // ✅ استيراد OneToMany
} from 'typeorm';
import { Subscription } from '../../subscriptions/entities/subscription.entity'; // ✅ استيراد كيان الاشتراك

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  companyName!: string;

  /**
   * شعار الشركة صورةً مصغّرة (Data URL) — يُطبع على الفواتير والتقارير. انظر
   * tenant-logo.ts. null = بلا شعار.
   */
  @Column({ type: 'varchar', nullable: true })
  logo_url?: string | null;

  @Column({ nullable: true })
  domain?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  address?: string;

  /** ISO 3166-1 alpha-2 — انظر common/constants/countries */
  @Column({ nullable: true })
  country?: string;

  /** ISO 4217 — تُشتق من الدولة عند إنشاء الشركة */
  @Column({ length: 3, default: 'SAR' })
  currency!: string;

  @Column({ default: 'ar' })
  language?: string;

  /** IANA */
  @Column({ default: 'Asia/Riyadh' })
  timezone?: string;

  @Column({ default: false })
  is_verified?: boolean;

  // ✅ علاقة عكسية: الشركة لديها العديد من الاشتراكات (تاريخ الفوترة)
  @OneToMany(() => Subscription, (sub) => sub.tenant)
  subscriptions?: Subscription[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @DeleteDateColumn({ nullable: true })
  deleted_at?: Date;
}
