// src/modules/notifications/notifications.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  type Paginated,
  paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import type { InboxQueryDto } from './dto/notification-query.dto';
import { NotificationStreamService } from './notification-stream.service';
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_TYPES,
  type NotificationGroup,
} from './notification-types';
import {
  groupOf,
  INBOX_SELECT,
  type InboxItem,
  type InboxRow,
  SENDER_JOIN,
  toInboxItem,
} from './notification-view';

export interface UnreadSummary {
  count: number;
  byGroup: Partial<Record<NotificationGroup, number>>;
}

/** حدث مزامنة لتبويبات المستخدم الأخرى بعد ما غيّره في واحد منها */
export interface InboxSync {
  action: 'read' | 'read_all' | 'acknowledged' | 'hidden' | 'removed';
  ids?: string[];
  unread?: number;
}

/** أنواع مجموعة (لتصفية القائمة بها) */
export const typesOfGroup = (group: string): string[] =>
  Object.entries(NOTIFICATION_TYPES)
    .filter(([, def]) => def.group === group)
    .map(([key]) => key);

/** صندوق إشعارات المستخدم: قائمته، غير المقروء، والقراءة والإخفاء */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly stream: NotificationStreamService,
  ) {}

  async list(
    userId: string,
    query: InboxQueryDto,
  ): Promise<Paginated<InboxItem> & { unread: number }> {
    const { page, limit, skip } = resolvePagination(query);
    const params: unknown[] = [userId];
    const where = [`r."userId" = $1`, `r."hiddenAt" IS NULL`];

    if (query.unread) where.push(`r."readAt" IS NULL`);
    if (query.type) {
      params.push(query.type);
      where.push(`n.type = $${params.length}`);
    } else if (query.group) {
      params.push(typesOfGroup(query.group));
      where.push(`n.type = ANY($${params.length}::text[])`);
    }

    const from = `FROM notification_recipients r
      JOIN notifications n ON n.id = r."notificationId"`;
    const [rows, counts, unread] = await Promise.all([
      this.dataSource.query<InboxRow[]>(
        `SELECT ${INBOX_SELECT} ${from} ${SENDER_JOIN}
          WHERE ${where.join(' AND ')}
          ORDER BY r."createdAt" DESC, r.id DESC
          LIMIT ${limit} OFFSET ${skip}`,
        params,
      ),
      this.dataSource.query<{ total: number }[]>(
        `SELECT COUNT(*)::int AS total ${from} WHERE ${where.join(' AND ')}`,
        params,
      ),
      this.unreadCount(userId),
    ]);

    return {
      ...paginated(rows.map(toInboxItem), counts[0].total, page, limit),
      unread: unread.count,
    };
  }

  async findOne(userId: string, id: string): Promise<InboxItem> {
    const rows = await this.dataSource.query<InboxRow[]>(
      `SELECT ${INBOX_SELECT}
         FROM notification_recipients r
         JOIN notifications n ON n.id = r."notificationId"
         ${SENDER_JOIN}
        WHERE r."userId" = $1 AND r."notificationId" = $2
          AND r."hiddenAt" IS NULL`,
      [userId, id],
    );
    if (!rows[0]) throw new NotFoundException('الإشعار غير موجود');
    return toInboxItem(rows[0]);
  }

  async unreadCount(userId: string): Promise<UnreadSummary> {
    const rows = await this.dataSource.query<{ type: string; count: number }[]>(
      `SELECT n.type, COUNT(*)::int AS count
         FROM notification_recipients r
         JOIN notifications n ON n.id = r."notificationId"
        WHERE r."userId" = $1 AND r."readAt" IS NULL AND r."hiddenAt" IS NULL
        GROUP BY n.type`,
      [userId],
    );
    const byGroup: UnreadSummary['byGroup'] = {};
    let count = 0;
    for (const row of rows) {
      const group = groupOf(row.type);
      byGroup[group] = (byGroup[group] ?? 0) + row.count;
      count += row.count;
    }
    return { count, byGroup };
  }

  async markRead(userId: string, ids: string[]): Promise<{ updated: number }> {
    const updated = await this.update(
      `UPDATE notification_recipients SET "readAt" = now()
        WHERE "userId" = $1 AND "notificationId" = ANY($2::uuid[])
          AND "readAt" IS NULL`,
      [userId, ids],
    );
    await this.sync(userId, { action: 'read', ids });
    return { updated };
  }

  async markAllRead(
    userId: string,
    group?: string,
  ): Promise<{ updated: number }> {
    const types =
      group && group in NOTIFICATION_GROUPS ? typesOfGroup(group) : null;
    const updated = await this.update(
      `UPDATE notification_recipients r SET "readAt" = now()
         FROM notifications n
        WHERE n.id = r."notificationId" AND r."userId" = $1
          AND r."readAt" IS NULL AND r."hiddenAt" IS NULL
          AND ($2::text[] IS NULL OR n.type = ANY($2::text[]))`,
      [userId, types],
    );
    await this.sync(userId, { action: 'read_all' });
    return { updated };
  }

  /** «تم الاطلاع» على رسالة تطلبه (ويُعدّ قراءة) */
  async acknowledge(userId: string, id: string): Promise<void> {
    const updated = await this.update(
      `UPDATE notification_recipients
          SET "acknowledgedAt" = COALESCE("acknowledgedAt", now()),
              "readAt" = COALESCE("readAt", now())
        WHERE "userId" = $1 AND "notificationId" = $2`,
      [userId, id],
    );
    if (updated === 0) throw new NotFoundException('الإشعار غير موجود');
    await this.sync(userId, { action: 'acknowledged', ids: [id] });
  }

  /** إخفاء إشعار من قائمة المستخدم (يبقى عند غيره وفي إحصاء الرسالة) */
  async hide(userId: string, id: string): Promise<void> {
    const updated = await this.update(
      `UPDATE notification_recipients SET "hiddenAt" = now()
        WHERE "userId" = $1 AND "notificationId" = $2 AND "hiddenAt" IS NULL`,
      [userId, id],
    );
    if (updated === 0) throw new NotFoundException('الإشعار غير موجود');
    await this.sync(userId, { action: 'hidden', ids: [id] });
  }

  /** إخفاء كل المقروء دفعة واحدة */
  async hideRead(userId: string): Promise<{ hidden: number }> {
    const hidden = await this.update(
      `UPDATE notification_recipients SET "hiddenAt" = now()
        WHERE "userId" = $1 AND "readAt" IS NOT NULL AND "hiddenAt" IS NULL`,
      [userId],
    );
    await this.sync(userId, { action: 'hidden' });
    return { hidden };
  }

  private async update(sql: string, params: unknown[]): Promise<number> {
    // pg يعيد [rows, rowCount] لأوامر UPDATE عبر DataSource.query
    const result: unknown = await this.dataSource.query(sql, params);
    return Array.isArray(result) && typeof result[1] === 'number'
      ? result[1]
      : 0;
  }

  /** تبويبات المستخدم الأخرى تحدّث قائمتها وعدّادها فوراً */
  private async sync(userId: string, event: InboxSync): Promise<void> {
    const { count } = await this.unreadCount(userId);
    this.stream.push([userId], 'sync', { ...event, unread: count });
  }
}
