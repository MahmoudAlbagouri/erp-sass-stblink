// src/modules/notifications/notifications.service.ts
import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Notification,
  NotificationCategory,
} from './entities/notification.entity';
import { User } from '../users/entities/user.entity';

interface INotificationPayload {
  recipientId: string;
  title: string;
  message: string;
  type?: any;
  category: NotificationCategory;
  referenceId?: string;
  referenceType?: string;
  actionUrl?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private notificationRepo: Repository<Notification>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async create(payload: INotificationPayload): Promise<Notification | null> {
    const recipient = await this.userRepo.findOne({
      where: { id: payload.recipientId },
    });
    if (!recipient) {
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
  async findAllForAdmin(filters?: {
    isRead?: boolean;
    category?: NotificationCategory;
    recipientName?: string;
    referenceType?: string;
    page?: number;
    limit?: number;
  }) {
    const query = this.notificationRepo
      .createQueryBuilder('notification')
      .leftJoinAndSelect('notification.recipient', 'recipient');

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
      query.andWhere('LOWER(recipient.fullName) LIKE LOWER(:name)', {
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
  async getAdminStats() {
    const total = await this.notificationRepo.count();
    const unread = await this.notificationRepo.count({
      where: { isRead: false },
    });

    const byCategory = await this.notificationRepo
      .createQueryBuilder('notification')
      .select('notification.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .groupBy('notification.category')
      .getRawMany();

    const recentExpiry = await this.notificationRepo.count({
      where: [
        { category: NotificationCategory.CONTRACT_EXPIRY, isRead: false },
        { category: NotificationCategory.ID_EXPIRY, isRead: false },
        { category: NotificationCategory.PROBATION_END, isRead: false },
      ],
    });

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
  async markAsReadByAdmin(notificationId: string): Promise<void> {
    const result = await this.notificationRepo.update(
      { id: notificationId },
      { isRead: true },
    );

    if (result.affected === 0) {
      throw new ForbiddenException('Notification not found');
    }
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
  async deleteByAdmin(notificationId: string): Promise<void> {
    const result = await this.notificationRepo.delete({ id: notificationId });

    if (result.affected === 0) {
      throw new ForbiddenException('Notification not found');
    }
  }
}
