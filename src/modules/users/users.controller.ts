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
import { Permissions } from '../../common/decorators/permissions.decorator';
import {
  CurrentUser,
  type CurrentUserData,
} from '../../common/decorators/current-user.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
// ✅ استيراد الثوابت
import { PERMS } from 'src/common/constants/permissions';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('system-stats')
  // ✅ استخدام الثابت بدلاً من النص المباشر
  @Permissions(PERMS.SYSTEM_STATS)
  @UseGuards(PermissionsGuard)
  getSystemStats() {
    return this.usersService.getSystemStats();
  }

  @Post()
  @Permissions(PERMS.USER_CREATE)
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
  @UseGuards(PermissionsGuard)
  findAll(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.usersService.findAll(user, tenantId);
  }

  @Get(':id')
  @Permissions(PERMS.USER_VIEW) // ✅ توحيد صلاحية العرض (أو يمكن إنشاء USER_VIEW_ONE إذا لزم الأمر)
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  // ✅ استخدام الثابت الجديد
  @Permissions(PERMS.USER_UPDATE)
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
  @UseGuards(PermissionsGuard)
  // ✅ تصحيح اسم الدالة من remo//... إلى remove
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
