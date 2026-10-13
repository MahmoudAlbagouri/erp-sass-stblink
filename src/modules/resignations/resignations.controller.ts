// src/modules/resignations/resignations.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import { ResignationsService } from './resignations.service';
import { CreateResignationDto } from './dto/create-resignation.dto';
import { DecisionResignationDto } from './dto/decision-resignation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard'; // ✅ استيراد الحارس
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator'; // ✅ استيراد ديكوراتور الميزة
import {
  CurrentUser,
  type CurrentUserData,
} from '../../common/decorators/current-user.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { PERMS } from '../../common/constants/permissions';
import { FEATURES } from '../../common/constants/features'; // ✅ استيراد الثوابت
import { ResignationStatus } from './entities/resignation.entity';

@ApiTags(apiTag('RESIGNATIONS'))
@Controller('resignations')
@UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ تفعيل حراس الاشتراك والمصادقة
export class ResignationsController {
  constructor(private readonly resignationsService: ResignationsService) {}

  // ✅ مسار جديد لجلب طلبات الموظف الحالي
  /** طلبات استقالة الموظف الحالي */
  @Get('my-requests')
  @Permissions(PERMS.RESIGNATION_REQUEST_SELF)
  @RequiresFeature(FEATURES.RESIGNATIONS_MODULE) // ✅ التحقق من توفر الموديول
  @UseGuards(PermissionsGuard)
  findMyRequests(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
  ) {
    if (!user.employeeId)
      throw new NotFoundException('حسابك غير مرتبط بملف موظف');
    return this.resignationsService.findMyRequests(user.employeeId, tenantId);
  }

  /** تقديم طلب استقالة */
  @Post('my-request')
  @Permissions(PERMS.RESIGNATION_REQUEST_SELF)
  @RequiresFeature(FEATURES.RESIGNATIONS_MODULE) // ✅ التحقق من توفر الموديول
  @UseGuards(PermissionsGuard)
  createMyRequest(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateResignationDto,
  ) {
    if (!user.employeeId)
      throw new NotFoundException('حسابك غير مرتبط بملف موظف');
    return this.resignationsService.create(dto, user.employeeId, tenantId);
  }

  /** سحب طلب الاستقالة المعلَّق */
  @Post('my-request/cancel')
  @Permissions(PERMS.RESIGNATION_REQUEST_SELF)
  @RequiresFeature(FEATURES.RESIGNATIONS_MODULE) // ✅ التحقق من توفر الموديول
  @UseGuards(PermissionsGuard)
  cancelMyRequest(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
  ) {
    if (!user.employeeId)
      throw new NotFoundException('حسابك غير مرتبط بملف موظف');
    return this.resignationsService.cancelMyRequest(user.employeeId, tenantId);
  }

  /** قبول طلب استقالة أو رفضه */
  @Post(':id/decision')
  @Permissions(PERMS.RESIGNATION_APPROVE)
  @RequiresFeature(FEATURES.RESIGNATIONS_MODULE) // ✅ التحقق من توفر الموديول
  @UseGuards(PermissionsGuard)
  makeDecision(
    @Param('id') id: string,
    @Body() dto: DecisionResignationDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.resignationsService.makeDecision(id, dto, tenantId);
  }

  /** قائمة طلبات الاستقالة */
  @Get()
  @Permissions(PERMS.RESIGNATION_VIEW_ALL)
  @RequiresFeature(FEATURES.RESIGNATIONS_MODULE) // ✅ حماية عرض القائمة
  @UseGuards(PermissionsGuard)
  findAll(
    @CurrentTenantId() tenantId: string,
    @Query('status') status?: ResignationStatus,
  ) {
    return this.resignationsService.findAll(tenantId, status);
  }

  /** طلب استقالة واحد */
  @Get(':id')
  @Permissions(PERMS.RESIGNATION_VIEW_ALL)
  @RequiresFeature(FEATURES.RESIGNATIONS_MODULE) // ✅ حماية عرض التفاصيل
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.resignationsService.findOne(id, tenantId);
  }
}
