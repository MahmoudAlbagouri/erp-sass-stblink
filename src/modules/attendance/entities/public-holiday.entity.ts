// src/modules/attendance/entities/public-holiday.entity.ts
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

/** عطلة رسمية للشركة (يوم أو فترة): لا غياب فيها، والعمل فيها إضافي */
@Entity('public_holidays')
@Index(['tenantId', 'startDate'])
export class PublicHoliday {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  @Column({ length: 100 })
  name!: string;

  /** YYYY-MM-DD بتقويم الشركة */
  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  /** آخر يوم في العطلة (شاملاً) */
  @Column({ name: 'end_date', type: 'date' })
  endDate!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
