// src/modules/leaves/leaves.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { CreateLeaveDto } from './dto/create-leave.dto';
import { LeaveStatus } from './entities/leave-request.entity';
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

@Controller('leaves')
@UseGuards(JwtAuthGuard)
export class LeavesController {
  constructor(private readonly leavesService: LeavesService) {}

  @Post('my-leaves')
  // ✅ استخدام ثابت الخدمة الذاتية للإجازات
  @Permissions(PERMS.LEAVE_REQUEST_SELF)
  @UseGuards(PermissionsGuard)
  createMyLeave(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateLeaveDto,
  ) {
    if (!user.employeeId)
      throw new NotFoundException('حسابك غير مرتبط بملف موظف');
    return this.leavesService.create(dto, user.employeeId, tenantId);
  }

  @Post('balance')
  @Permissions(PERMS.LEAVE_BALANCE_MANAGE)
  @UseGuards(PermissionsGuard)
  async setBalance(
    @Body() dto: { employeeId: string; year: number; amount: number },
    @CurrentTenantId() tenantId: string,
  ) {
    return await this.leavesService.setBalance(dto, tenantId);
  }

  @Post('admin/:employeeId')
  @Permissions(PERMS.LEAVE_CREATE_ADMIN)
  @UseGuards(PermissionsGuard)
  createForEmployee(
    @Param('employeeId') employeeId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateLeaveDto,
  ) {
    return this.leavesService.create(dto, employeeId, tenantId);
  }

  @Get()
  @Permissions(PERMS.LEAVE_VIEW)
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.leavesService.findAll(tenantId);
  }

  @Patch(':id/status')
  @Permissions(PERMS.LEAVE_APPROVE)
  @UseGuards(PermissionsGuard)
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: LeaveStatus,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.leavesService.updateStatus(id, status, tenantId);
  }
}
