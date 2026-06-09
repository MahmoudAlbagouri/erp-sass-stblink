// src/modules/permissions/permissions.controller.ts
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
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
// import { SystemAdminGuard } from '../../common/guards/system-admin.guard'; // ✅ استيراد حارس المالك
// import { SystemAdmin } from '../../common/decorators/system-admin.decorator';

@Controller('permissions')
@UseGuards(JwtAuthGuard) // ✅ حماية عامة: يجب تسجيل الدخول أولاً
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Post()
  @Permissions('create_permission')
  @UseGuards(PermissionsGuard)
  create(@Body() dto: CreatePermissionDto) {
    return this.permissionsService.create(dto);
  }

  @Get()
  @Permissions('view_permissions')
  @UseGuards(PermissionsGuard)
  findAll() {
    return this.permissionsService.findAll();
  }

  @Get(':id')
  @Permissions('view_permissions')
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string) {
    return this.permissionsService.findOne(id);
  }

  @Patch(':id')
  @Permissions('update_permission')
  @UseGuards(PermissionsGuard)
  update(@Param('id') id: string, @Body() dto: UpdatePermissionDto) {
    return this.permissionsService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('delete_permission')
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string) {
    return this.permissionsService.remove(id);
  }
}
