// src/modules/notifications/notifications.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { apiTag } from '../../config/swagger.config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { PERMS } from '../../common/constants/permissions';
import {
  AdminNotificationsQueryDto,
  InboxQueryDto,
  MarkReadDto,
  ReadAllDto,
  UpdatePreferencesDto,
} from './dto/notification-query.dto';
import { NotificationsService } from './notifications.service';
import { NotificationsAdminService } from './notifications-admin.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationStreamService } from './notification-stream.service';
import { NotificationChecksService } from './scanners/notification-checks.service';
import { NOTIFICATION_GROUPS, NOTIFICATION_TYPES } from './notification-types';

/** مالك النظام يرى كل الشركات (null)، وغيره يُقيَّد بشركته */
const adminScope = (user: CurrentUserData): string | null =>
  user.isSystemAdmin ? null : user.tenantId;

@ApiTags(apiTag('NOTIFICATIONS'))
@Controller('notifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(
    private readonly inbox: NotificationsService,
    private readonly admin: NotificationsAdminService,
    private readonly preferences: NotificationPreferencesService,
    private readonly stream: NotificationStreamService,
    private readonly checks: NotificationChecksService,
  ) {}

  // ═══════════════ إشعاراتي ═══════════════

  /** إشعارات المستخدم الحالي (صفحات، وتصفية بالمجموعة أو النوع أو غير المقروء) */
  @Get()
  @Permissions(PERMS.NOTIFICATION_VIEW)
  list(@CurrentUser() user: CurrentUserData, @Query() query: InboxQueryDto) {
    return this.inbox.list(user.id, query);
  }

  /** عدد غير المقروء (إجمالي ولكل مجموعة) */
  @Get('unread-count')
  @Permissions(PERMS.NOTIFICATION_VIEW)
  unreadCount(@CurrentUser() user: CurrentUserData) {
    return this.inbox.unreadCount(user.id);
  }

  /** أنواع الإشعارات ومجموعاتها (أسماؤها وأيقوناتها وهل تُكتم) */
  @Get('types')
  @Permissions(PERMS.NOTIFICATION_VIEW)
  types() {
    return {
      groups: Object.entries(NOTIFICATION_GROUPS).map(([key, label]) => ({
        key,
        label,
      })),
      types: Object.entries(NOTIFICATION_TYPES).map(([key, def]) => ({
        key,
        ...def,
      })),
    };
  }

  /** البث اللحظي (Server-Sent Events): إشعار جديد يصل فور إنشائه */
  @Get('stream')
  @Permissions(PERMS.NOTIFICATION_VIEW)
  openStream(
    @CurrentUser() user: CurrentUserData,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // nginx: لا تخزين مؤقت للبث
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    // المتصفح يعيد الاتصال بعد 5 ثوانٍ إن انقطع
    res.write('retry: 5000\n\n');

    const unregister = this.stream.register(user.id, res);
    req.on('close', unregister);
  }

  /** الأنواع التي كتمها المستخدم */
  @Get('preferences')
  @Permissions(PERMS.NOTIFICATION_VIEW)
  getPreferences(@CurrentUser() user: CurrentUserData) {
    return this.preferences.get(user.id);
  }

  /** كتم أنواع / إلغاء كتمها (ما لا يُكتم يُرفض) */
  @Patch('preferences')
  @Permissions(PERMS.NOTIFICATION_VIEW)
  updatePreferences(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.preferences.update(user.id, dto.mutedTypes);
  }

  /** تعليم إشعارات كمقروءة */
  @Post('read')
  @Permissions(PERMS.NOTIFICATION_VIEW)
  markRead(@CurrentUser() user: CurrentUserData, @Body() dto: MarkReadDto) {
    return this.inbox.markRead(user.id, dto.ids);
  }

  /** تعليم الكل كمقروء (أو مجموعة واحدة) */
  @Post('read-all')
  @Permissions(PERMS.NOTIFICATION_VIEW)
  markAllRead(@CurrentUser() user: CurrentUserData, @Body() dto: ReadAllDto) {
    return this.inbox.markAllRead(user.id, dto.group);
  }

  /** إخفاء كل المقروء من القائمة */
  @Post('hide-read')
  @Permissions(PERMS.NOTIFICATION_DELETE)
  hideRead(@CurrentUser() user: CurrentUserData) {
    return this.inbox.hideRead(user.id);
  }

  // ═══════════════ لوحة المدير ═══════════════

  /** كل إشعارات الشركة: من استلم كل إشعار ومن قرأه */
  @Get('admin/all')
  @Permissions(PERMS.NOTIFICATION_VIEW_ALL)
  adminList(
    @CurrentUser() user: CurrentUserData,
    @Query() query: AdminNotificationsQueryDto,
  ) {
    return this.admin.list(adminScope(user), query);
  }

  /** إحصاءات إشعارات الشركة */
  @Get('admin/stats')
  @Permissions(PERMS.NOTIFICATION_VIEW_ALL)
  adminStats(@CurrentUser() user: CurrentUserData) {
    return this.admin.stats(adminScope(user));
  }

  /** تشغيل الفحوص الدورية للشركة الآن (انتهاء العقود، المخزون، الفواتير...) */
  @Post('admin/run-checks')
  @Permissions(PERMS.NOTIFICATION_VIEW_ALL)
  runChecks(@CurrentUser() user: CurrentUserData) {
    if (!user.tenantId) {
      throw new BadRequestException('الفحوص تُشغَّل من داخل شركة');
    }
    return this.checks.runForTenant(user.tenantId);
  }

  /** مستلمو إشعار: من قرأ ومتى ومن أكّد الاطلاع */
  @Get('admin/:id/recipients')
  @Permissions(PERMS.NOTIFICATION_VIEW_ALL)
  adminRecipients(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.admin.recipients(adminScope(user), id);
  }

  /** حذف إشعار نهائياً من عند كل مستلميه */
  @Delete('admin/:id')
  @Permissions(PERMS.NOTIFICATION_VIEW_ALL, PERMS.NOTIFICATION_DELETE)
  async adminRemove(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.admin.remove(adminScope(user), id);
    return { success: true };
  }

  // ═══════════════ إشعار واحد ═══════════════

  /** تفاصيل إشعار من إشعاراتي */
  @Get(':id')
  @Permissions(PERMS.NOTIFICATION_VIEW)
  findOne(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inbox.findOne(user.id, id);
  }

  /** تعليم إشعار كمقروء */
  @Post(':id/read')
  @Permissions(PERMS.NOTIFICATION_VIEW)
  markOneRead(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inbox.markRead(user.id, [id]);
  }

  /** «تم الاطلاع» على رسالة تطلبه */
  @Post(':id/ack')
  @Permissions(PERMS.NOTIFICATION_VIEW)
  async acknowledge(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.inbox.acknowledge(user.id, id);
    return { success: true };
  }

  /** إخفاء إشعار من قائمتي */
  @Delete(':id')
  @Permissions(PERMS.NOTIFICATION_DELETE)
  async hide(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.inbox.hide(user.id, id);
    return { success: true };
  }
}
