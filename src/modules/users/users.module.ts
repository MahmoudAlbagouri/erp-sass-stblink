// src/modules/users/users.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { Role } from '../roles/entities/role.entity'; // <-- تأكد من استيراد الكيان الصحيح
import { UsersQuotaResolver } from './users-quota.resolver';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  // أضف Role داخل المصفوفة هنا ليتمكن NestJS من إنشاء الـ Repository له
  imports: [TypeOrmModule.forFeature([User, Role]), SubscriptionsModule], // استيراد موديول الاشتراكات
  controllers: [UsersController],
  providers: [UsersService, UsersQuotaResolver],
  exports: [UsersService],
})
export class UsersModule {}
