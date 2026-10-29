// src/modules/notifications/entities/notification-alert-state.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * حالة قائمة يُنبَّه عند دخولها مرة واحدة (صنف تحت حد الطلب، فاتورة تأخر
 * سدادها): السطر يبقى ما دامت الحالة، ويُحذف عند زوالها فيُنبَّه إن عادت.
 */
@Entity('notification_alert_states')
export class NotificationAlertState {
  /** مثل low-stock:<stockLevelId> */
  @PrimaryColumn({ type: 'varchar', length: 200 })
  key!: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  raisedAt!: Date;
}
