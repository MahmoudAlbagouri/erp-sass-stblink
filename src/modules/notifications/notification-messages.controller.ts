// src/modules/notifications/notification-messages.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { PERMS } from '../../common/constants/permissions';
import {
  PreviewMessageDto,
  SendMessageDto,
  SentMessagesQueryDto,
} from './dto/send-message.dto';
import { NotificationMessagesService } from './notification-messages.service';

/**
 * رسائل الإدارة للموظفين: لموظفين بعينهم بصلاحية create_notification، وللجميع
 * أو فروع أو أقسام من مسار broadcast بصلاحية broadcast_notification معها.
 */
@ApiTags(apiTag('NOTIFICATIONS'))
@Controller('notifications/messages')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationMessagesController {
  constructor(private readonly messages: NotificationMessagesService) {}

  /** كم سيستلم الرسالة، ومن لن تصله لأنه بلا حساب دخول */
  @Post('preview')
  @Permissions(PERMS.NOTIFICATION_CREATE)
  preview(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: PreviewMessageDto,
  ) {
    return this.messages.preview(user, dto.audience);
  }

  /** إرسال رسالة لموظفين بعينهم */
  @Post()
  @Permissions(PERMS.NOTIFICATION_CREATE)
  send(@CurrentUser() user: CurrentUserData, @Body() dto: SendMessageDto) {
    return this.messages.send(user, dto, 'direct');
  }

  /** إرسال رسالة جماعية: للجميع أو لموظفي فروع أو أقسام */
  @Post('broadcast')
  @Permissions(PERMS.NOTIFICATION_CREATE, PERMS.NOTIFICATION_BROADCAST)
  broadcast(@CurrentUser() user: CurrentUserData, @Body() dto: SendMessageDto) {
    return this.messages.send(user, dto, 'broadcast');
  }

  /** الرسائل المرسلة ونسبة من قرأها */
  @Get()
  @Permissions(PERMS.NOTIFICATION_CREATE)
  sent(
    @CurrentUser() user: CurrentUserData,
    @Query() query: SentMessagesQueryDto,
  ) {
    return this.messages.sent(user, query);
  }

  /** مستلمو رسالة: من قرأ ومن أكّد الاطلاع */
  @Get(':id/recipients')
  @Permissions(PERMS.NOTIFICATION_CREATE)
  recipients(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.messages.recipients(user, id);
  }
}
