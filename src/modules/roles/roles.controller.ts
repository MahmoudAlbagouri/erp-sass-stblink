// src/modules/roles/roles.controller.ts
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
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
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

@Controller('roles')
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Post()
  @Permissions(PERMS.ROLE_CREATE)
  @UseGuards(PermissionsGuard)
  create(
    @Body() dto: CreateRoleDto,
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.rolesService.create(dto, user, tenantId);
  }

  @Get()
  @Permissions(PERMS.ROLE_VIEW)
  @UseGuards(PermissionsGuard)
  findAll(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.rolesService.findAll(user, tenantId);
  }

  @Get(':id')
  @Permissions(PERMS.ROLE_VIEW)
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string) {
    return this.rolesService.findOne(id);
  }

  @Patch(':id')
  @Permissions(PERMS.ROLE_UPDATE)
  @UseGuards(PermissionsGuard)
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @Permissions(PERMS.ROLE_DELETE)
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string) {
    return this.rolesService.remove(id);
  }
}
