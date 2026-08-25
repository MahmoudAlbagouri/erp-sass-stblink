// src/modules/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { Notification } from './entities/notification.entity';
import { User } from '../users/entities/user.entity';
import { Contract } from '../contracts/entities/contract.entity';

import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ExpiryCheckStrategy } from './strategies/expiry-check.strategy';
import { NotificationInterceptor } from './interceptors/notification.interceptor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, User, Contract]),
    ScheduleModule.forRoot(),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    ExpiryCheckStrategy,
    NotificationInterceptor,
  ],
  exports: [NotificationsService, NotificationInterceptor],
})
export class NotificationsModule {}
