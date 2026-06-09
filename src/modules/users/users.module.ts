// src/modules/users/users.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './entities/user.entity';
import { Role } from '../roles/entities/role.entity'; // <-- تأكد من استيراد الكيان الصحيح

@Module({
  // أضف Role داخل المصفوفة هنا ليتمكن NestJS من إنشاء الـ Repository له
  imports: [TypeOrmModule.forFeature([User, Role])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
