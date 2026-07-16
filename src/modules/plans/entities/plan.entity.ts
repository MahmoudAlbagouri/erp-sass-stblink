import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BillingCycle } from '../../../common/enums/subscription.enums';

export interface PlanQuotas {
  max_users?: number;
  max_employees?: number;
  max_invoices?: number;
  max_storage_mb?: number;
  [key: string]: number | undefined;
}

@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  name!: string;

  @Column()
  nameAr!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  price!: string;

  @Column({ type: 'enum', enum: BillingCycle, default: BillingCycle.MONTHLY })
  billingCycle!: BillingCycle;

  @Column({ type: 'jsonb', default: [] })
  features!: string[];

  @Column({ type: 'jsonb', default: {} })
  quotas!: PlanQuotas;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ default: false })
  isCustom!: boolean;

  @Column({ default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
