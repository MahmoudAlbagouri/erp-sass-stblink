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
  ParseUUIDPipe,
} from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { LeaveCarryoverCronService } from './leave-carryover.cron.service';
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
import { PERMS } from 'src/common/constants/permissions';

@Controller('leaves')
@UseGuards(JwtAuthGuard)
export class LeavesController {
  constructor(
    private readonly leavesService: LeavesService,
    private readonly carryoverCronService: LeaveCarryoverCronService,
  ) {}

  /**
   * تقديم إجازة جديدة (للموظف الحالي)
   */
  @Post('my-leaves')
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

  /**
   * جلب تفاصيل الرصيد الديناميكي لموظف معين (يتضمن الآن الحد الائتماني المسموح به)
   */
  @Get('accrual/:employeeId')
  @Permissions(PERMS.LEAVE_VIEW)
  @UseGuards(PermissionsGuard)
  async getAccrualDetails(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return await this.leavesService.getAccrualDetails(employeeId, tenantId);
  }

  /**
   * تعيين رصيد الإجازات يدوياً (للأدمن)
   */
  @Post('balance')
  @Permissions(PERMS.LEAVE_BALANCE_MANAGE)
  @UseGuards(PermissionsGuard)
  async setBalance(
    @Body() dto: { employeeId: string; year: number; amount: number },
    @CurrentTenantId() tenantId: string,
  ) {
    return await this.leavesService.setBalance(dto, tenantId);
  }

  /**
   * ✅ جديد: إعادة حساب ترحيل الرصيد يدوياً لموظف محدد (بدل انتظار الـ Cron).
   * يعالج أي دورات سنوية فائتة (Backfilling) بأمان بفضل فحص Idempotency.
   */
  @Post('carryover/recalculate/:employeeId')
  @Permissions(PERMS.LEAVE_BALANCE_MANAGE)
  @UseGuards(PermissionsGuard)
  recalculateCarryOverForEmployee(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.carryoverCronService.recalculateForEmployee(
      employeeId,
      tenantId,
    );
  }

  /**
   * ✅ جديد: إعادة حساب ترحيل الرصيد يدوياً لجميع الموظفين دفعة واحدة.
   */
  @Post('carryover/recalculate-all')
  @Permissions(PERMS.LEAVE_BALANCE_MANAGE)
  @UseGuards(PermissionsGuard)
  recalculateCarryOverForAll() {
    return this.carryoverCronService.recalculateAll();
  }

  /**
   * تقديم إجازة لموظف آخر (للأدمن)
   */
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

  /**
   * جلب جميع طلبات الإجازات
   */
  @Get()
  @Permissions(PERMS.LEAVE_VIEW)
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.leavesService.findAll(tenantId);
  }

  /**
   * تحديث حالة طلب الإجازة (موافقة/رفض)
   */
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
