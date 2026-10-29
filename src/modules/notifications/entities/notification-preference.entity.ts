// src/modules/notifications/entities/notification-preference.entity.ts
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/** أنواع كتمها المستخدم: لا تصله (عدا ما لا يُكتم — انظر NOTIFICATION_TYPES) */
@Entity('notification_preferences')
export class NotificationPreference {
  @PrimaryColumn('uuid')
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  mutedTypes!: string[];

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
