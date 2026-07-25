import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ResignationsService } from './resignations.service';
import { CreateResignationDto } from './dto/create-resignation.dto';
import { DecisionResignationDto } from './dto/decision-resignation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { PERMS } from '../../common/constants/permissions';
import { ResignationStatus } from './entities/resignation.entity';

// ✅ تعريف واجهة للمستخدم لتجنب استخدام any
interface CurrentUserData {
  id: string;
  employeeId?: string;
}

@Controller('resignations')
@UseGuards(JwtAuthGuard)
export class ResignationsController {
  constructor(private readonly resignationsService: ResignationsService) {}

  // ✅ مسار جديد لجلب طلبات الموظف الحالي
  @Get('my-requests')
  @Permissions(PERMS.RESIGNATION_REQUEST_SELF)
  @UseGuards(PermissionsGuard)
  findMyRequests(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
  ) {
    if (!user.employeeId) throw new Error('حسابك غير مرتبط بموظف');
    return this.resignationsService.findMyRequests(user.employeeId, tenantId);
  }

  @Post('my-request')
  @Permissions(PERMS.RESIGNATION_REQUEST_SELF)
  @UseGuards(PermissionsGuard)
  createMyRequest(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateResignationDto,
  ) {
    if (!user.employeeId) throw new Error('حسابك غير مرتبط بموظف');
    return this.resignationsService.create(dto, user.employeeId, tenantId);
  }

  @Post('my-request/cancel')
  @Permissions(PERMS.RESIGNATION_REQUEST_SELF)
  @UseGuards(PermissionsGuard)
  cancelMyRequest(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
  ) {
    if (!user.employeeId) throw new Error('حسابك غير مرتبط بموظف');
    return this.resignationsService.cancelMyRequest(user.employeeId, tenantId);
  }

  @Post(':id/decision')
  @Permissions(PERMS.RESIGNATION_APPROVE)
  @UseGuards(PermissionsGuard)
  makeDecision(
    @Param('id') id: string,
    @Body() dto: DecisionResignationDto,
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.resignationsService.makeDecision(id, dto, user.id, tenantId);
  }

  @Get()
  @Permissions(PERMS.RESIGNATION_VIEW_ALL)
  @UseGuards(PermissionsGuard)
  findAll(
    @CurrentTenantId() tenantId: string,
    @Query('status') status?: ResignationStatus,
  ) {
    return this.resignationsService.findAll(tenantId, status);
  }

  @Get(':id')
  @Permissions(PERMS.RESIGNATION_VIEW_ALL)
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.resignationsService.findOne(id, tenantId);
  }
}
