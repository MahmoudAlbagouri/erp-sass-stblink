import { SetMetadata } from '@nestjs/common';
import {
  NotificationCategory,
  NotificationType,
} from '../entities/notification.entity';

export const NOTIFY_KEY = 'notification_config';

export interface NotifyConfig {
  category: NotificationCategory;
  type?: NotificationType;
  titleField?: string;
  messageField?: string;
  recipientField?: string;
  referenceIdField?: string;
  condition?: (data: any) => boolean;
}

export function Notify(config: NotifyConfig) {
  return SetMetadata(NOTIFY_KEY, config);
}
