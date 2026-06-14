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

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('system-stats')
  @Permissions('system:view_platform_stats')
  @UseGuards(PermissionsGuard)
  getSystemStats() {
    return this.usersService.getSystemStats();
  }

  @Post()
  @Permissions('create_user')
  @UseGuards(PermissionsGuard)
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.usersService.create(dto, user, tenantId);
  }

  @Get()
  @Permissions('view_users')
  @UseGuards(PermissionsGuard)
  findAll(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.usersService.findAll(user, tenantId);
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
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.usersService.update(id, dto, user);
  }

  @Delete(':id')
  @Permissions('delete_user')
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
