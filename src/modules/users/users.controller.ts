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
import { SystemAdminGuard } from '../../common/guards/system-admin.guard';
import { SystemAdmin } from '../../common/decorators/system-admin.decorator';

// src/modules/users/users.controller.ts
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ✅ مسار نظامي حصري - يعتمد على PermissionsGuard مع صلاحية system:
  @Get('system-stats')
  @Permissions('system:view_platform_stats')
  @UseGuards(PermissionsGuard) // ✅ حارس واحد يكفي للتحقق المزدوج
  getSystemStats() {
    return {
      totalUsers: 1,
      totalTenants: 0,
      message: 'مرحباً بك يا مالك النظام! هذه إحصائيات المنصة الكاملة.',
    };
  }

  // ✅ باقي المسارات تبقى كما هي للصلاحيات العادية
  @Post()
  @Permissions('create_user')
  @UseGuards(PermissionsGuard)
  create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @Permissions('view_users')
  @UseGuards(PermissionsGuard)
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @Permissions('view_users')
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @Permissions('update_user')
  @UseGuards(PermissionsGuard)
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @Permissions('delete_user')
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
