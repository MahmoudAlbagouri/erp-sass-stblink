// src/modules/notifications/notifier.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  Notification,
  type NotificationDetail,
} from './entities/notification.entity';
import { NotificationRecipient } from './entities/notification-recipient.entity';
import {
  Audience,
  NotificationAudienceService,
} from './notification-audience.service';
import { NotificationStreamService } from './notification-stream.service';
import {
  isMutableType,
  type NotificationSeverity,
  type NotificationType,
} from './notification-types';
import { freshInboxItem } from './notification-view';

const DAY_MS = 24 * 60 * 60 * 1000;
/** إشعارات النظام تُحذف بعد ستة أشهر؛ رسائل الإدارة تبقى */
const DEFAULT_RETENTION_DAYS = 180;
const INSERT_CHUNK = 1000;

export interface NotifyInput {
  /** null = إشعار على مستوى المنصة */
  tenantId: string | null;
  type: NotificationType;
  severity?: NotificationSeverity;
  title: string;
  body: string;
  details?: NotificationDetail[];
  data?: Record<string, unknown>;
  entity?: { type: string; id: string } | null;
  /** صفحة الواجهة (/dashboard/...) */
  link?: string | null;
  to: Audience | Audience[];
  /** لا يستلمه — عادةً من فعل الحدث بنفسه */
  exclude?: (string | null | undefined)[];
  /** مفتاح فريد: إن سبق إنشاؤه لا يُنشأ ثانية (أمان ضد التكرار) */
  dedupeKey?: string | null;
  senderId?: string | null;
  requiresAck?: boolean;
  /** أيام الاحتفاظ (null = دائم). الافتراضي 180 */
  retentionDays?: number | null;
}

export interface NotifyResult {
  id: string | null;
  recipients: number;
  /** نفس dedupeKey أُنشئ من قبل */
  duplicate: boolean;
}

/**
 * المدخل الوحيد لإنشاء إشعار: يحدد المستلمين، يستبعد من كتم النوع، يكتب
 * الإشعار ومستلميه في معاملة واحدة، ثم يبثه لهم لحظياً.
 */
@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audience: NotificationAudienceService,
    private readonly stream: NotificationStreamService,
  ) {}

  async notify(input: NotifyInput): Promise<NotifyResult> {
    const userIds = await this.recipientsOf(input);
    if (userIds.length === 0) {
      return { id: null, recipients: 0, duplicate: false };
    }

    const retention =
      input.retentionDays === undefined
        ? DEFAULT_RETENTION_DAYS
        : input.retentionDays;

    const created = await this.dataSource.transaction(async (manager) => {
      const insert = await manager
        .createQueryBuilder()
        .insert()
        .into(Notification)
        .values({
          tenantId: input.tenantId,
          type: input.type,
          severity: input.severity ?? 'info',
          title: input.title.slice(0, 200),
          body: input.body,
          details: input.details ?? [],
          // jsonb حر: نوع TypeORM الجزئي لا يعبّر عن unknown
          data: (input.data ?? {}) as never,
          entityType: input.entity?.type ?? null,
          entityId: input.entity?.id ?? null,
          link: input.link ?? null,
          senderId: input.senderId ?? null,
          requiresAck: input.requiresAck ?? false,
          dedupeKey: input.dedupeKey ?? null,
          recipientCount: userIds.length,
          expiresAt: retention
            ? new Date(Date.now() + retention * DAY_MS)
            : null,
        })
        // dedupeKey مكرر: لا شيء (الفهرس الفريد هو الضامن، لا فحص مسبق)
        .orIgnore()
        .returning(['id', 'createdAt'])
        .execute();

      const row = (insert.raw as { id: string; createdAt: Date }[])[0];
      if (!row) return null;

      for (let i = 0; i < userIds.length; i += INSERT_CHUNK) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(NotificationRecipient)
          .values(
            userIds.slice(i, i + INSERT_CHUNK).map((userId) => ({
              notificationId: row.id,
              userId,
              tenantId: input.tenantId,
              createdAt: row.createdAt,
            })),
          )
          .orIgnore()
          .execute();
      }
      return row;
    });

    if (!created) return { id: null, recipients: 0, duplicate: true };

    this.stream.push(
      userIds,
      'notification',
      freshInboxItem(
        {
          id: created.id,
          type: input.type,
          severity: input.severity ?? 'info',
          title: input.title,
          body: input.body,
          details: input.details ?? [],
          data: input.data ?? {},
          entityType: input.entity?.type ?? null,
          entityId: input.entity?.id ?? null,
          link: input.link ?? null,
          requiresAck: input.requiresAck ?? false,
          createdAt: created.createdAt,
          senderId: input.senderId ?? null,
        },
        await this.senderName(input.senderId),
      ),
    );

    return { id: created.id, recipients: userIds.length, duplicate: false };
  }

  /**
   * مثل notify لكنه لا يرمي: للمستمعين والفاحصين — فشل إشعار يُسجَّل ولا
   * يوقف ما بعده.
   */
  async notifySafe(input: NotifyInput): Promise<NotifyResult | null> {
    try {
      return await this.notify(input);
    } catch (error) {
      this.logger.error(
        `notification "${input.type}" failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return null;
    }
  }

  private async recipientsOf(input: NotifyInput): Promise<string[]> {
    const audiences = Array.isArray(input.to) ? input.to : [input.to];
    const excluded = new Set(input.exclude?.filter(Boolean));
    const userIds = (
      await this.audience.resolve(input.tenantId, audiences)
    ).filter((id) => !excluded.has(id));

    if (userIds.length === 0 || !isMutableType(input.type)) return userIds;

    const muted: { userId: string }[] = await this.dataSource.query(
      `SELECT "userId" FROM notification_preferences
        WHERE "userId" = ANY($1::uuid[])
          AND "mutedTypes" @> jsonb_build_array($2::text)`,
      [userIds, input.type],
    );
    const mutedIds = new Set(muted.map((m) => m.userId));
    return userIds.filter((id) => !mutedIds.has(id));
  }

  private async senderName(
    senderId: string | null | undefined,
  ): Promise<string | null> {
    if (!senderId) return null;
    const rows: { name: string }[] = await this.dataSource.query(
      `SELECT COALESCE(e."fullName", u.username) AS name
         FROM users u
         LEFT JOIN employees e ON e.user_id = u.id AND e."deletedAt" IS NULL
        WHERE u.id = $1`,
      [senderId],
    );
    return rows[0]?.name ?? null;
  }
}
