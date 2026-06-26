// src/modules/advances/advances.controller.ts
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
import { AdvancesService } from './advances.service';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { AdvanceStatus } from './entities/advance.entity';
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

@Controller('advances')
@UseGuards(JwtAuthGuard)
export class AdvancesController {
  constructor(private readonly advancesService: AdvancesService) {}

  /**
   * مسار الخدمة الذاتية (الموظف يطلب سلفة لنفسه)
   */
  @Post('my-advances')
  // ✅ استخدام ثابت الصلاحية للخدمة الذاتية
  @Permissions(PERMS.ADVANCE_REQUEST_SELF)
  @UseGuards(PermissionsGuard)
  createMyAdvance(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateAdvanceDto,
  ) {
    if (!user.employeeId)
      throw new NotFoundException('حسابك غير مرتبط بملف موظف');
    return this.advancesService.create(dto, user.employeeId, tenantId);
  }

  /**
   * مسار إداري (HR يطلب سلفة لموظف معين)
   */
  @Post('admin/:employeeId')
  @Permissions(PERMS.ADVANCE_CREATE_ADMIN)
  @UseGuards(PermissionsGuard)
  createForEmployee(
    @Param('employeeId') employeeId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateAdvanceDto,
  ) {
    return this.advancesService.create(dto, employeeId, tenantId);
  }

  @Get()
  @Permissions(PERMS.ADVANCE_VIEW)
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.advancesService.findAll(tenantId);
  }

  @Patch(':id/status')
  @Permissions(PERMS.ADVANCE_APPROVE)
  @UseGuards(PermissionsGuard)
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: AdvanceStatus,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.advancesService.updateStatus(id, status, tenantId);
  }
}
