// src/modules/notifications/notifications-admin.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  type Paginated,
  paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import type { AdminNotificationsQueryDto } from './dto/notification-query.dto';
import type { NotificationDetail } from './entities/notification.entity';
import { NotificationStreamService } from './notification-stream.service';
import type {
  NotificationGroup,
  NotificationSeverity,
} from './notification-types';
import { typesOfGroup } from './notifications.service';
import { groupOf, SENDER_JOIN } from './notification-view';

/** نطاق الإدارة: الشركة، أو null لمالك النظام (كل الشركات والمنصة) */
export type NotificationAdminScope = string | null;

/** إشعار في لوحة المدير: محتواه + كم وصل ومن قرأ */
export interface AdminNotificationRow {
  id: string;
  type: string;
  group: NotificationGroup;
  severity: NotificationSeverity;
  title: string;
  body: string;
  details: NotificationDetail[];
  link: string | null;
  requiresAck: boolean;
  createdAt: Date;
  sender: { id: string; name: string } | null;
  recipients: number;
  read: number;
  acknowledged: number;
  /** اسم المستلم حين يكون واحداً */
  recipientName: string | null;
}

export interface NotificationRecipientRow {
  userId: string;
  name: string;
  employeeCode: string | null;
  readAt: Date | null;
  acknowledgedAt: Date | null;
}

interface AdminRaw {
  id: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  details: NotificationDetail[];
  link: string | null;
  requiresAck: boolean;
  createdAt: Date;
  senderId: string | null;
  senderName: string | null;
  recipients: number;
  read: number;
  acknowledged: number;
  firstRecipient: string | null;
}

/** أنواع تنبيهات الانتهاء (العاجل في الإحصاءات) */
const EXPIRY_TYPES = ['contract_expiry', 'iqama_expiry', 'probation_end'];

/** لوحة المدير: كل إشعارات الشركة، من استلمها ومن قرأها، وإحصاءاتها */
@Injectable()
export class NotificationsAdminService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly stream: NotificationStreamService,
  ) {}

  async list(
    scope: NotificationAdminScope,
    query: AdminNotificationsQueryDto & { senderId?: string },
  ): Promise<Paginated<AdminNotificationRow>> {
    const { page, limit, skip } = resolvePagination(query);
    const params: unknown[] = [scope];
    const where = [`($1::uuid IS NULL OR n."tenantId" = $1)`];

    if (query.type) {
      params.push(query.type);
      where.push(`n.type = $${params.length}`);
    } else if (query.group) {
      params.push(typesOfGroup(query.group));
      where.push(`n.type = ANY($${params.length}::text[])`);
    }
    if (query.senderId) {
      params.push(query.senderId);
      where.push(`n."senderId" = $${params.length}`);
    }
    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      const p = `$${params.length}`;
      where.push(`(n.title ILIKE ${p} OR n.body ILIKE ${p} OR EXISTS (
        SELECT 1 FROM notification_recipients sr
          JOIN users su2 ON su2.id = sr."userId"
          LEFT JOIN employees se2 ON se2.user_id = su2.id
         WHERE sr."notificationId" = n.id
           AND (su2.username ILIKE ${p} OR se2."fullName" ILIKE ${p}
                OR se2."employeeCode" ILIKE ${p})))`);
    }

    const [rows, counts] = await Promise.all([
      this.dataSource.query<AdminRaw[]>(
        `SELECT n.id, n.type, n.severity, n.title, n.body, n.details, n.link,
                n."requiresAck", n."createdAt", n."senderId",
                COALESCE(se."fullName", su.username) AS "senderName",
                s.recipients, s.read, s.acknowledged, s."firstRecipient"
           FROM notifications n
           ${SENDER_JOIN}
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS recipients,
                    COUNT(r."readAt")::int AS read,
                    COUNT(r."acknowledgedAt")::int AS acknowledged,
                    MIN(COALESCE(re."fullName", ru.username)) AS "firstRecipient"
               FROM notification_recipients r
               JOIN users ru ON ru.id = r."userId"
               LEFT JOIN employees re ON re.user_id = ru.id AND re."deletedAt" IS NULL
              WHERE r."notificationId" = n.id
           ) s ON true
          WHERE ${where.join(' AND ')}
          ORDER BY n."createdAt" DESC, n.id DESC
          LIMIT ${limit} OFFSET ${skip}`,
        params,
      ),
      this.dataSource.query<{ total: number }[]>(
        `SELECT COUNT(*)::int AS total FROM notifications n
          WHERE ${where.join(' AND ')}`,
        params,
      ),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        type: row.type,
        group: groupOf(row.type),
        severity: row.severity,
        title: row.title,
        body: row.body,
        details: row.details ?? [],
        link: row.link,
        requiresAck: row.requiresAck,
        createdAt: row.createdAt,
        sender:
          row.senderId && row.senderName
            ? { id: row.senderId, name: row.senderName }
            : null,
        recipients: row.recipients ?? 0,
        read: row.read ?? 0,
        acknowledged: row.acknowledged ?? 0,
        recipientName: row.recipients === 1 ? row.firstRecipient : null,
      })),
      counts[0].total,
      page,
      limit,
    );
  }

  async stats(scope: NotificationAdminScope) {
    const [totals, byType] = await Promise.all([
      this.dataSource.query<
        {
          total: number;
          last7Days: number;
          deliveries: number;
          unreadDeliveries: number;
          urgentUnread: number;
        }[]
      >(
        `SELECT
           (SELECT COUNT(*)::int FROM notifications n
             WHERE ($1::uuid IS NULL OR n."tenantId" = $1)) AS total,
           (SELECT COUNT(*)::int FROM notifications n
             WHERE ($1::uuid IS NULL OR n."tenantId" = $1)
               AND n."createdAt" >= now() - interval '7 days') AS "last7Days",
           (SELECT COUNT(*)::int FROM notification_recipients r
             WHERE ($1::uuid IS NULL OR r."tenantId" = $1)) AS deliveries,
           (SELECT COUNT(*)::int FROM notification_recipients r
             WHERE ($1::uuid IS NULL OR r."tenantId" = $1)
               AND r."readAt" IS NULL AND r."hiddenAt" IS NULL) AS "unreadDeliveries",
           (SELECT COUNT(DISTINCT n.id)::int FROM notifications n
              JOIN notification_recipients r ON r."notificationId" = n.id
             WHERE ($1::uuid IS NULL OR n."tenantId" = $1)
               AND n.type = ANY($2::text[]) AND r."readAt" IS NULL) AS "urgentUnread"`,
        [scope, EXPIRY_TYPES],
      ),
      this.dataSource.query<{ type: string; count: number }[]>(
        `SELECT n.type, COUNT(*)::int AS count FROM notifications n
          WHERE ($1::uuid IS NULL OR n."tenantId" = $1)
          GROUP BY n.type`,
        [scope],
      ),
    ]);

    const byGroup: Partial<Record<NotificationGroup, number>> = {};
    for (const row of byType) {
      const group = groupOf(row.type);
      byGroup[group] = (byGroup[group] ?? 0) + row.count;
    }
    return { ...totals[0], byGroup };
  }

  /** مستلمو إشعار: من قرأ ومتى، ومن أكّد الاطلاع */
  async recipients(
    scope: NotificationAdminScope,
    id: string,
  ): Promise<NotificationRecipientRow[]> {
    await this.assertInScope(scope, id);
    return this.dataSource.query<NotificationRecipientRow[]>(
      `SELECT r."userId", COALESCE(e."fullName", u.username) AS name,
              e."employeeCode", r."readAt", r."acknowledgedAt"
         FROM notification_recipients r
         JOIN users u ON u.id = r."userId"
         LEFT JOIN employees e ON e.user_id = u.id AND e."deletedAt" IS NULL
        WHERE r."notificationId" = $1
        ORDER BY r."readAt" IS NULL DESC, name`,
      [id],
    );
  }

  /** حذف إشعار نهائياً من عند كل مستلميه */
  async remove(scope: NotificationAdminScope, id: string): Promise<void> {
    await this.assertInScope(scope, id);
    const recipients = await this.dataSource.query<{ userId: string }[]>(
      `SELECT "userId" FROM notification_recipients WHERE "notificationId" = $1`,
      [id],
    );
    await this.dataSource.query(`DELETE FROM notifications WHERE id = $1`, [
      id,
    ]);
    this.stream.push(
      recipients.map((r) => r.userId),
      'sync',
      { action: 'removed', ids: [id] },
    );
  }

  async assertInScope(
    scope: NotificationAdminScope,
    id: string,
  ): Promise<void> {
    const rows = await this.dataSource.query<{ id: string }[]>(
      `SELECT id FROM notifications
        WHERE id = $1 AND ($2::uuid IS NULL OR "tenantId" = $2)`,
      [id, scope],
    );
    if (!rows[0]) throw new NotFoundException('الإشعار غير موجود');
  }
}
