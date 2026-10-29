// src/modules/attendance/attendance-settings.controller.ts
// سياسة الحضور للشركة وعطلاتها الرسمية.
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { PERMS } from '../../common/constants/permissions';
import { FEATURES } from '../../common/constants/features';
import { AttendanceSettingsService } from './attendance-settings.service';
import { BiometricSyncService } from './biometric-sync.service';
import { UpdateAttendanceSettingsDto } from './dto/attendance-settings.dto';
import {
  CreateHolidayDto,
  HolidayQueryDto,
  UpdateHolidayDto,
} from './dto/holiday.dto';

@ApiTags(apiTag('ATTENDANCE'))
@Controller('attendance')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class AttendanceSettingsController {
  constructor(
    private readonly settings: AttendanceSettingsService,
    private readonly sync: BiometricSyncService,
  ) {}

  /** سياسة الحضور: أيام الراحة، ربط الحضور بالمسير، نسخ البصمات */
  @Get('settings')
  @Permissions(PERMS.ATTENDANCE_SUMMARY_VIEW)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
  @UseGuards(PermissionsGuard)
  getSettings(@CurrentTenantId() tenantId: string) {
    return this.settings.getPolicy(tenantId);
  }

  /** تعديل سياسة الحضور. إيقاف نسخ البصمات يحذف كل القوالب المحفوظة */
  @Patch('settings')
  @Permissions(PERMS.ATTENDANCE_SETTINGS_MANAGE)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
  @UseGuards(PermissionsGuard)
  async updateSettings(
    @Body() dto: UpdateAttendanceSettingsDto,
    @CurrentTenantId() tenantId: string,
  ) {
    const policy = await this.settings.updatePolicy(tenantId, dto);
    if (!policy.syncBiometrics) await this.sync.purge(tenantId);
    return policy;
  }

  /** العطلات الرسمية (لسنة إن حُددت) */
  @Get('holidays')
  @Permissions(PERMS.ATTENDANCE_SUMMARY_VIEW)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
  @UseGuards(PermissionsGuard)
  findHolidays(
    @Query() query: HolidayQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settings.findHolidays(tenantId, query);
  }

  /** إضافة عطلة رسمية (يوم أو فترة) */
  @Post('holidays')
  @Permissions(PERMS.ATTENDANCE_SETTINGS_MANAGE)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
  @UseGuards(PermissionsGuard)
  createHoliday(
    @Body() dto: CreateHolidayDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settings.createHoliday(tenantId, dto);
  }

  /** تعديل عطلة رسمية */
  @Patch('holidays/:id')
  @Permissions(PERMS.ATTENDANCE_SETTINGS_MANAGE)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
  @UseGuards(PermissionsGuard)
  updateHoliday(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateHolidayDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settings.updateHoliday(id, tenantId, dto);
  }

  /** حذف عطلة رسمية */
  @Delete('holidays/:id')
  @HttpCode(204)
  @Permissions(PERMS.ATTENDANCE_SETTINGS_MANAGE)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
  @UseGuards(PermissionsGuard)
  removeHoliday(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settings.removeHoliday(id, tenantId);
  }
}
