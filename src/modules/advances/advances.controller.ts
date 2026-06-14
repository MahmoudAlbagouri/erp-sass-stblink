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

@Controller('advances')
@UseGuards(JwtAuthGuard)
export class AdvancesController {
  constructor(private readonly advancesService: AdvancesService) {}

  /**
   * مسار الخدمة الذاتية (الموظف يطلب سلفة لنفسه)
   */
  @Post('my-advances')
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
  @Permissions('create_advance')
  @UseGuards(PermissionsGuard)
  createForEmployee(
    @Param('employeeId') employeeId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateAdvanceDto,
  ) {
    return this.advancesService.create(dto, employeeId, tenantId);
  }

  @Get()
  @Permissions('view_advances')
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.advancesService.findAll(tenantId);
  }

  @Patch(':id/status')
  @Permissions('approve_advance')
  @UseGuards(PermissionsGuard)
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: AdvanceStatus,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.advancesService.updateStatus(id, status, tenantId);
  }
}
