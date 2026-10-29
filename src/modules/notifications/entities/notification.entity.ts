// src/modules/notifications/entities/notification.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import type { NotificationSeverity } from '../notification-types';
import { NotificationRecipient } from './notification-recipient.entity';

/** سطر في «التفاصيل» المعروضة مع الإشعار */
export interface NotificationDetail {
  label: string;
  value: string | number | null;
  /** طريقة العرض: نص، تاريخ (YYYY-MM-DD)، وقت (ISO)، مبلغ بعملة الشركة */
  format?: 'text' | 'date' | 'datetime' | 'money';
}

/**
 * محتوى الإشعار مرة واحدة، ومستلموه في notification_recipients: رسالة لـ 300
 * موظف = سطر هنا و300 سطر خفيف هناك (ومنه يُعرف من قرأ ومن لم يقرأ).
 */
@Entity('notifications')
@Index(['tenantId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** فارغ = إشعار على مستوى المنصة (لمالك النظام) */
  @Column({ type: 'uuid', nullable: true })
  tenantId!: string | null;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant?: Tenant;

  /** مفتاح من NOTIFICATION_TYPES */
  @Column({ type: 'varchar', length: 60 })
  type!: string;

  @Column({ type: 'varchar', length: 16, default: 'info' })
  severity!: NotificationSeverity;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  details!: NotificationDetail[];

  /** بيانات للواجهة لا للعرض المباشر (تاريخ انتهاء تُحسب منه الأيام حيّاً) */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  data!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 40, nullable: true })
  entityType!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  entityId!: string | null;

  /** صفحة الواجهة التي يفتحها الإشعار (/dashboard/...) */
  @Column({ type: 'varchar', length: 300, nullable: true })
  link!: string | null;

  /** مرسل رسالة الإدارة (فارغ = النظام) */
  @Column({ type: 'uuid', nullable: true })
  senderId!: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'senderId' })
  sender?: User | null;

  /** يطلب من المستلم تأكيد «تم الاطلاع» */
  @Column({ default: false })
  requiresAck!: boolean;

  /** نفس المفتاح لا يُنشأ مرتين (فهرس فريد) — به يُمنع التكرار */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 200, nullable: true })
  dedupeKey!: string | null;

  @Column({ type: 'int', default: 0 })
  recipientCount!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  /** يُحذف بعده تلقائياً (فارغ = يبقى) */
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @OneToMany(() => NotificationRecipient, (r) => r.notification)
  recipients?: NotificationRecipient[];
}
