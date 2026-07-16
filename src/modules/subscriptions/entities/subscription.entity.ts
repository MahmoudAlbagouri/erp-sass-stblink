import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { SubscriptionStatus } from '../../../common/enums/subscription.enums';
import { Plan } from '../../plans/entities/plan.entity';

export interface PlanQuotas {
  max_users?: number;
  max_employees?: number;
  max_invoices?: number;
  max_storage_mb?: number;
  [key: string]: number | undefined;
}

@Entity('subscriptions')
@Index(['tenantId', 'status'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Tenant, (tenant) => tenant.subscriptions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'tenantId' })
  tenant!: Tenant;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => Plan, { eager: true })
  @JoinColumn({ name: 'planId' })
  plan!: Plan;

  @Column({ type: 'uuid' })
  planId!: string;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.TRIAL,
  })
  status!: SubscriptionStatus;

  @Column({ type: 'timestamptz' })
  startDate!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endDate?: Date;

  @Column({ default: false })
  autoRenew!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  quotaOverrides?: PlanQuotas;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
