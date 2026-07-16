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
  company_name!: string;

  @Column({ nullable: true })
  logo_url?: string;

  @Column({ nullable: true })
  domain?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  address?: string;

  @Column({ nullable: true })
  country?: string;

  @Column({ default: 'ar' })
  language?: string;

  @Column({ default: 'UTC+3' })
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
