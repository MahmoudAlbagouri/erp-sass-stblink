// src/modules/users/users.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard'; // ✅ استيراد الحارس
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator'; // ✅ استيراد ديكوراتور الميزة
import { CheckQuota } from '../../common/decorators/check-quota.decorator'; // ✅ استيراد ديكوراتور الحصة
import {
  CurrentUser,
  type CurrentUserData,
} from '../../common/decorators/current-user.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { PERMS } from 'src/common/constants/permissions';
import { FEATURES } from 'src/common/constants/features'; // ✅ استيراد الثوابت

@Controller('users')
@UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ تفعيل حراس الاشتراك والمصادقة
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('system-stats')
  @Permissions(PERMS.SYSTEM_STATS)
  @RequiresFeature(FEATURES.EMPLOYEES_MODULE) // ✅ إحصائيات النظام عادة مرتبطة بالموظفين أو الإدارة العامة
  @UseGuards(PermissionsGuard)
  getSystemStats() {
    return this.usersService.getSystemStats();
  }

  @Post()
  @Permissions(PERMS.USER_CREATE)
  @RequiresFeature(FEATURES.EMPLOYEES_MODULE) // ✅ إدارة المستخدمين جزء من البنية الأساسية للموظفين
  @CheckQuota('max_users') // ✅ التحقق من حصة المستخدمين قبل الإنشاء
  @UseGuards(PermissionsGuard)
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.usersService.create(dto, user, tenantId);
  }

  @Get()
  @Permissions(PERMS.USER_VIEW)
  @RequiresFeature(FEATURES.EMPLOYEES_MODULE) // ✅ حماية عرض القائمة
  @UseGuards(PermissionsGuard)
  findAll(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.usersService.findAll(user, tenantId);
  }

  @Get(':id')
  @Permissions(PERMS.USER_VIEW)
  @RequiresFeature(FEATURES.EMPLOYEES_MODULE) // ✅ حماية عرض التفاصيل
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @Permissions(PERMS.USER_UPDATE)
  @RequiresFeature(FEATURES.EMPLOYEES_MODULE) // ✅ حماية التعديل
  @UseGuards(PermissionsGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.usersService.update(id, dto, user);
  }

  @Delete(':id')
  @Permissions(PERMS.USER_DELETE)
  @RequiresFeature(FEATURES.EMPLOYEES_MODULE) // ✅ حماية الحذف
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
