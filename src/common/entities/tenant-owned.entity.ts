// src/common/entities/tenant-owned.entity.ts
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../modules/tenants/entities/tenant.entity';

/**
 * أساس كيانات الموديولات التجارية (أصناف، مخزون، مشتريات، مبيعات):
 *
 * - `tenantId`  عزل الشركات — كل استعلام يجب أن يقيَّد به.
 * - `updatedAt` تعتمد عليه مزامنة نقاط البيع ("ما الذي تغيّر منذ آخر سحب؟").
 * - `deletedAt` حذف منطقي: السجل يبقى لأن فواتير وحركات قديمة تشير إليه،
 *   ولأن أجهزة الكاشير غير المتصلة يجب أن تعرف لاحقاً أنه حُذف.
 */
export abstract class TenantOwnedEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant?: Tenant;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
