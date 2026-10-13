import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Delete,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { PERMS } from '../../common/constants/permissions';

// ✅ استيراد الـ DTOs
import {
  FindNotificationsDto,
  FindAllForAdminDto,
} from './dto/query-notifications.dto';
import { CreateNotificationDto } from './dto/create-notification.dto';

/** مالك النظام يرى كل الشركات (null)، وغيره يُقيَّد بشركته */
const adminScope = (user: CurrentUserData): string | null =>
  user.isSystemAdmin ? null : user.tenantId;

@ApiTags(apiTag('NOTIFICATIONS'))
@Controller('notifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  // ═══════════════════════════════════════════
  // 🔵 Endpoints للموظفين (إشعاراتهم فقط)
  // ═══════════════════════════════════════════

  /** إشعارات المستخدم الحالي */
  @Get()
  @Permissions(PERMS.NOTIFICATION_VIEW)
  async findAll(
    @CurrentUser() user: CurrentUserData,
    @Query() query: FindNotificationsDto, // ✅ DTO بدلاً من any
  ) {
    return this.notificationsService.findByUser(user.id, {
      isRead:
        query.isRead === 'true'
          ? true
          : query.isRead === 'false'
            ? false
            : undefined,
      category: query.category,
    });
  }

  /** عدد الإشعارات غير المقروءة */
  @Get('unread-count')
  @Permissions(PERMS.NOTIFICATION_VIEW)
  async getUnreadCount(@CurrentUser() user: CurrentUserData) {
    const count = await this.notificationsService.countUnread(user.id);
    return { count };
  }

  /** تعليم إشعار كمقروء */
  @Post(':id/read')
  @Permissions(PERMS.NOTIFICATION_UPDATE)
  async markAsRead(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.notificationsService.markAsRead(id, user.id);
    return { success: true };
  }

  /** تعليم كل الإشعارات كمقروءة */
  @Post('read-all')
  @Permissions(PERMS.NOTIFICATION_UPDATE)
  async markAllAsRead(@CurrentUser() user: CurrentUserData) {
    await this.notificationsService.markAllAsRead(user.id);
    return { success: true };
  }

  /** حذف إشعار */
  @Delete(':id')
  @Permissions(PERMS.NOTIFICATION_DELETE)
  async delete(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    await this.notificationsService.delete(id, user.id);
    return { success: true };
  }

  /** إرسال إشعار لمستخدمين */
  @Post()
  @Permissions(PERMS.NOTIFICATION_CREATE)
  async createNotification(
    @Body() body: CreateNotificationDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const notification = await this.notificationsService.create(
      {
        recipientId: body.recipientId,
        title: body.title,
        message: body.message,
        category: body.category,
        referenceId: body.referenceId,
        referenceType: body.referenceType,
      },
      adminScope(user),
    );
    return { success: true, data: notification };
  }

  // ═══════════════════════════════════════════
  // 🔴 Endpoints للمديرين (جميع إشعارات النظام)
  // ═══════════════════════════════════════════

  /** كل إشعارات الشركة (للمديرين) */
  @Get('admin/all')
  @Permissions(PERMS.NOTIFICATION_VIEW_ALL)
  async findAllForAdmin(
    @Query() query: FindAllForAdminDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.notificationsService.findAllForAdmin(adminScope(user), {
      isRead:
        query.isRead === 'true'
          ? true
          : query.isRead === 'false'
            ? false
            : undefined,
      category: query.category,
      recipientName: query.recipientName,
      referenceType: query.referenceType,
      page: query.page,
      limit: query.limit,
    });
  }

  /** إحصائيات الإشعارات (للمديرين) */
  @Get('admin/stats')
  @Permissions(PERMS.NOTIFICATION_VIEW_ALL)
  async getAdminStats(@CurrentUser() user: CurrentUserData) {
    return this.notificationsService.getAdminStats(adminScope(user));
  }

  /** تعليم إشعار أي مستخدم كمقروء (للمديرين) */
  @Post('admin/:id/read')
  @Permissions(PERMS.NOTIFICATION_VIEW_ALL)
  async markAsReadByAdmin(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.notificationsService.markAsReadByAdmin(id, adminScope(user));
    return { success: true };
  }

  /** حذف إشعار أي مستخدم (للمديرين) */
  @Delete('admin/:id')
  @Permissions(PERMS.NOTIFICATION_VIEW_ALL)
  async deleteByAdmin(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    await this.notificationsService.deleteByAdmin(id, adminScope(user));
    return { success: true };
  }
}
