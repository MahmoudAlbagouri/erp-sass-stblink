// src/modules/auth/entities/support-session.entity.ts
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';

/**
 * سجل دخول مالك النظام (أو أحد موظفيه) إلى بيانات شركة في "وضع الدعم".
 * سجل للمراجعة فقط: من دخل، أي شركة، ومتى — لا يُعدَّل من الواجهة.
 */
@Entity('support_sessions')
@Index(['tenantId', 'startedAt'])
@Index(['ownerId', 'tenantId', 'lastSeenAt'])
export class SupportSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** مستخدم مالك النظام الذي دخل */
  @Column({ type: 'uuid' })
  ownerId!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant?: Tenant;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  startedAt!: Date;

  /** آخر تجديد للجلسة: يمتد ما دام يعمل داخل الشركة */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;
}
