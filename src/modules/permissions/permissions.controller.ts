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
import {
  CurrentUser,
  type CurrentUserData,
} from '../../common/decorators/current-user.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
// ✅ استيراد الثوابت
import { PERMS } from 'src/common/constants/permissions';

@Controller('permissions')
@UseGuards(JwtAuthGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Post()
  @Permissions(PERMS.PERMISSION_CREATE)
  @UseGuards(PermissionsGuard)
  create(
    @Body() dto: CreatePermissionDto,
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.permissionsService.create(dto, user, tenantId);
  }

  @Get()
  @Permissions(PERMS.PERMISSION_VIEW)
  @UseGuards(PermissionsGuard)
  findAll(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.permissionsService.findAll(user, tenantId);
  }

  @Get(':id')
  @Permissions(PERMS.PERMISSION_VIEW)
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string) {
    return this.permissionsService.findOne(id);
  }

  @Patch(':id')
  @Permissions(PERMS.PERMISSION_UPDATE)
  @UseGuards(PermissionsGuard)
  update(@Param('id') id: string, @Body() dto: UpdatePermissionDto) {
    return this.permissionsService.update(id, dto);
  }

  @Delete(':id')
  @Permissions(PERMS.PERMISSION_DELETE)
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string) {
    return this.permissionsService.remove(id);
  }
}
