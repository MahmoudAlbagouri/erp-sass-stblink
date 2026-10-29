// src/modules/notifications/notification-view.ts
// شكل الإشعار كما يصل للواجهة (القائمة، التفاصيل، والبث اللحظي) — مكان واحد.
import type {
  Notification,
  NotificationDetail,
} from './entities/notification.entity';
import {
  isNotificationType,
  NOTIFICATION_TYPES,
  type NotificationGroup,
  type NotificationSeverity,
} from './notification-types';

export interface InboxItem {
  id: string;
  type: string;
  group: NotificationGroup;
  severity: NotificationSeverity;
  title: string;
  body: string;
  details: NotificationDetail[];
  data: Record<string, unknown>;
  entityType: string | null;
  entityId: string | null;
  link: string | null;
  requiresAck: boolean;
  createdAt: Date;
  readAt: Date | null;
  acknowledgedAt: Date | null;
  sender: { id: string; name: string } | null;
}

export const groupOf = (type: string): NotificationGroup =>
  isNotificationType(type) ? NOTIFICATION_TYPES[type].group : 'system';

/** أعمدة الإشعار + حالته عند المستلم + اسم المرسل (انظر INBOX_SELECT) */
export interface InboxRow {
  id: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  details: NotificationDetail[];
  data: Record<string, unknown>;
  entityType: string | null;
  entityId: string | null;
  link: string | null;
  requiresAck: boolean;
  createdAt: Date;
  readAt: Date | null;
  acknowledgedAt: Date | null;
  senderId: string | null;
  senderName: string | null;
}

/** SELECT لصف InboxRow: n = notifications، r = notification_recipients */
export const INBOX_SELECT = `
  n.id, n.type, n.severity, n.title, n.body, n.details, n.data,
  n."entityType", n."entityId", n.link, n."requiresAck", n."createdAt",
  r."readAt", r."acknowledgedAt", n."senderId",
  COALESCE(se."fullName", su.username) AS "senderName"`;

/** JOIN اسم المرسل (موظف إن كان له ملف، وإلا اسم المستخدم) */
export const SENDER_JOIN = `
  LEFT JOIN users su ON su.id = n."senderId"
  LEFT JOIN employees se ON se.user_id = su.id AND se."deletedAt" IS NULL`;

export const toInboxItem = (row: InboxRow): InboxItem => ({
  id: row.id,
  type: row.type,
  group: groupOf(row.type),
  severity: row.severity,
  title: row.title,
  body: row.body,
  details: row.details ?? [],
  data: row.data ?? {},
  entityType: row.entityType,
  entityId: row.entityId,
  link: row.link,
  requiresAck: row.requiresAck,
  createdAt: row.createdAt,
  readAt: row.readAt,
  acknowledgedAt: row.acknowledgedAt,
  sender:
    row.senderId && row.senderName
      ? { id: row.senderId, name: row.senderName }
      : null,
});

/** إشعار جديد كما يُبث لمستلميه (لم يُقرأ بعد) */
export const freshInboxItem = (
  notification: Pick<
    Notification,
    | 'id'
    | 'type'
    | 'severity'
    | 'title'
    | 'body'
    | 'details'
    | 'data'
    | 'entityType'
    | 'entityId'
    | 'link'
    | 'requiresAck'
    | 'createdAt'
    | 'senderId'
  >,
  senderName: string | null,
): InboxItem =>
  toInboxItem({
    ...notification,
    readAt: null,
    acknowledgedAt: null,
    senderName,
  });
