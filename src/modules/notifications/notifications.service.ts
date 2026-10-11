// src/modules/notifications/notifications.service.ts
import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  Notification,
  NotificationCategory,
  NotificationType,
} from './entities/notification.entity';
import { User } from '../users/entities/user.entity';

interface INotificationPayload {
  recipientId: string;
  title: string;
  message: string;
  type?: NotificationType;
  category: NotificationCategory;
  referenceId?: string;
  referenceType?: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
}

/** نطاق الإدارة: معرّف الشركة، أو null لمالك النظام (كل الشركات) */
export type NotificationAdminScope = string | null;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private notificationRepo: Repository<Notification>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  /**
   * @param senderTenantScope عند الإرسال من الـ API: شركة المُرسِل، لمنع
   * إرسال إشعار لمستخدم في شركة أخرى. يُترك فارغاً للاستخدام الداخلي.
   */
  async create(
    payload: INotificationPayload,
    senderTenantScope?: NotificationAdminScope,
  ): Promise<Notification | null> {
    const recipient = await this.userRepo.findOne({
      where: { id: payload.recipientId },
    });
    if (
      !recipient ||
      (senderTenantScope && recipient.tenantId !== senderTenantScope)
    ) {
      this.logger.error(`Recipient not found: ${payload.recipientId}`);
      return null;
    }

    const notification = this.notificationRepo.create({
      ...payload,
      recipient,
      isRead: false,
    });

    return this.notificationRepo.save(notification);
  }

  /**
   * جلب إشعارات مستخدم معين (للموظف العادي)
   */
  async findByUser(
    userId: string,
    filters?: { isRead?: boolean; category?: NotificationCategory },
  ) {
    const query = this.notificationRepo
      .createQueryBuilder('notification')
      .leftJoinAndSelect('notification.recipient', 'recipient')
      .where('recipient.id = :userId', { userId });

    if (filters?.isRead !== undefined) {
      query.andWhere('notification.isRead = :isRead', {
        isRead: filters.isRead,
      });
    }
    if (filters?.category) {
      query.andWhere('notification.category = :category', {
        category: filters.category,
      });
    }

    query.orderBy('notification.createdAt', 'DESC');
    return query.getMany();
  }

  /**
   * ✅ جديد: جلب جميع الإشعارات للمديرين
   * يدعم الفلترة حسب: الفئة، حالة القراءة، اسم الموظف، المرجع
   */
  async findAllForAdmin(
    tenantScope: NotificationAdminScope,
    filters?: {
      isRead?: boolean;
      category?: NotificationCategory;
      recipientName?: string;
      referenceType?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const query = this.scopedAdminQuery(tenantScope).leftJoinAndSelect(
      'notification.recipient',
      'recipient',
    );

    if (filters?.isRead !== undefined) {
      query.andWhere('notification.isRead = :isRead', {
        isRead: filters.isRead,
      });
    }

    if (filters?.category) {
      query.andWhere('notification.category = :category', {
        category: filters.category,
      });
    }

    if (filters?.recipientName) {
      // User لا يملك fullName — الاسم المتاح هو username
      query.andWhere('LOWER(recipient.username) LIKE LOWER(:name)', {
        name: `%${filters.recipientName}%`,
      });
    }

    if (filters?.referenceType) {
      query.andWhere('notification.referenceType = :refType', {
        refType: filters.referenceType,
      });
    }

    query.orderBy('notification.createdAt', 'DESC');

    // Pagination
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    query.skip((page - 1) * limit).take(limit);

    const [items, total] = await query.getManyAndCount();

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * ✅ جديد: إحصائيات الإشعارات للمديرين (Dashboard)
   */
  async getAdminStats(tenantScope: NotificationAdminScope) {
    const total = await this.scopedAdminQuery(tenantScope).getCount();
    const unread = await this.scopedAdminQuery(tenantScope)
      .andWhere('notification.isRead = false')
      .getCount();

    const byCategory = await this.scopedAdminQuery(tenantScope)
      .select('notification.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .groupBy('notification.category')
      .getRawMany<{ category: NotificationCategory; count: string }>();

    const recentExpiry = await this.scopedAdminQuery(tenantScope)
      .andWhere('notification.isRead = false')
      .andWhere('notification.category IN (:...expiryCategories)', {
        expiryCategories: [
          NotificationCategory.CONTRACT_EXPIRY,
          NotificationCategory.ID_EXPIRY,
          NotificationCategory.PROBATION_END,
        ],
      })
      .getCount();

    return {
      total,
      unread,
      recentExpiryUnread: recentExpiry,
      byCategory,
    };
  }

  async countUnread(userId: string): Promise<number> {
    return this.notificationRepo.count({
      where: { recipient: { id: userId }, isRead: false },
    });
  }

  async markAsRead(notificationId: string, userId: string): Promise<void> {
    const result = await this.notificationRepo.update(
      { id: notificationId, recipient: { id: userId } },
      { isRead: true },
    );

    if (result.affected === 0) {
      throw new ForbiddenException(
        'Notification not found or not owned by user',
      );
    }
  }

  /**
   * ✅ جديد: المدير يقدر يحدد أي إشعار كمقروء (ليس فقط الخاص به)
   */
  async markAsReadByAdmin(
    notificationId: string,
    tenantScope: NotificationAdminScope,
  ): Promise<void> {
    await this.assertInAdminScope(notificationId, tenantScope);
    await this.notificationRepo.update(
      { id: notificationId },
      { isRead: true },
    );
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationRepo.update(
      { recipient: { id: userId }, isRead: false },
      { isRead: true },
    );
  }

  async delete(notificationId: string, userId: string): Promise<void> {
    const result = await this.notificationRepo.delete({
      id: notificationId,
      recipient: { id: userId },
    });

    if (result.affected === 0) {
      throw new ForbiddenException(
        'Notification not found or not owned by user',
      );
    }
  }

  /**
   * ✅ جديد: المدير يقدر يحذف أي إشعار
   */
  async deleteByAdmin(
    notificationId: string,
    tenantScope: NotificationAdminScope,
  ): Promise<void> {
    await this.assertInAdminScope(notificationId, tenantScope);
    await this.notificationRepo.delete({ id: notificationId });
  }

  /**
   * ✅ عزل الشركات: مدير الشركة يرى إشعارات مستخدمي شركته فقط،
   * ومالك النظام (tenantScope = null) يرى الكل.
   */
  private scopedAdminQuery(
    tenantScope: NotificationAdminScope,
  ): SelectQueryBuilder<Notification> {
    const query = this.notificationRepo.createQueryBuilder('notification');
    if (tenantScope) {
      query
        .innerJoin('notification.recipient', 'scopeRecipient')
        .where('scopeRecipient.tenantId = :tenantScope', { tenantScope });
    }
    return query;
  }

  private async assertInAdminScope(
    notificationId: string,
    tenantScope: NotificationAdminScope,
  ): Promise<void> {
    const exists = await this.scopedAdminQuery(tenantScope)
      .andWhere('notification.id = :notificationId', { notificationId })
      .getExists();
    if (!exists) throw new NotFoundException('Notification not found');
  }
}
