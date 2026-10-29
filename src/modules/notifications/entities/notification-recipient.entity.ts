// src/modules/notifications/entities/notification-recipient.entity.ts
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Notification } from './notification.entity';

/** وصول إشعار لمستخدم: حالته عنده (قرأه، أكّد اطلاعه، أخفاه) */
@Entity('notification_recipients')
@Index(['notificationId', 'userId'], { unique: true })
@Index(['userId', 'createdAt'])
@Index(['userId'], { where: '"readAt" IS NULL AND "hiddenAt" IS NULL' })
@Index(['tenantId', 'createdAt'])
export class NotificationRecipient {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  notificationId!: string;

  @ManyToOne(() => Notification, (n) => n.recipients, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'notificationId' })
  notification?: Notification;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  /** شركة الإشعار منسوخة هنا: بها تُقيَّد لوحة المدير بلا join */
  @Column({ type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledgedAt!: Date | null;

  /** أخفاه المستخدم من قائمته (يبقى محسوباً في إحصاء الرسالة) */
  @Column({ type: 'timestamptz', nullable: true })
  hiddenAt!: Date | null;

  /** وقت الإشعار منسوخاً: الترتيب والتصفح من الفهرس مباشرة */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;
}
