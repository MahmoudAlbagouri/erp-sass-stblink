// src/modules/attendance/attendance.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard'; // ✅ استيراد الحارس
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator'; // ✅ استيراد ديكوراتور الميزة
import { CheckQuota } from '../../common/decorators/check-quota.decorator'; // ✅ استيراد ديكوراتور الحصة
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type CurrentUserData } from '../../common/decorators/current-user.decorator';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { AttendanceQueryDto } from './dto/attendance-query.dto';
import { PERMS } from 'src/common/constants/permissions';
import { FEATURES } from 'src/common/constants/features'; // ✅ استيراد الثوابت

@Controller('attendance')
@UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ تفعيل حراس الاشتراك والمصادقة
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('devices')
  @Permissions(PERMS.BIOMETRIC_DEVICE_CREATE)
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION) // ✅ التحقق من توفر ميزة ربط البصمة
  @CheckQuota('max_biometric_devices') // ✅ التحقق من حصة عدد الأجهزة
  @UseGuards(PermissionsGuard)
  createDevice(
    @Body() dto: CreateDeviceDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.createDevice(dto, user);
  }

  @Post('devices/:id/push-user/:employeeId')
  @Permissions(PERMS.BIOMETRIC_DEVICE_SYNC)
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION) // ✅ التحقق من توفر الميزة
  @UseGuards(PermissionsGuard)
  pushUserToDevice(
    @Param('id') id: string,
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.pushUserToDevice(id, employeeId, user);
  }

  @Get('devices')
  @Permissions(PERMS.BIOMETRIC_DEVICE_VIEW)
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION) // ✅ حماية عرض الأجهزة
  @UseGuards(PermissionsGuard)
  findAllDevices(@CurrentUser() user: CurrentUserData) {
    return this.attendanceService.findAllDevices(user);
  }

  @Get('devices/:id')
  @Permissions(PERMS.BIOMETRIC_DEVICE_VIEW)
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION) // ✅ حماية عرض تفاصيل الجهاز
  @UseGuards(PermissionsGuard)
  findOneDevice(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.attendanceService.findOneDevice(id, user);
  }

  @Patch('devices/:id')
  @Permissions(PERMS.BIOMETRIC_DEVICE_UPDATE)
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION) // ✅ حماية تعديل الجهاز
  @UseGuards(PermissionsGuard)
  updateDevice(
    @Param('id') id: string,
    @Body() dto: UpdateDeviceDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.updateDevice(id, dto, user);
  }

  @Delete('devices/:id')
  @Permissions(PERMS.BIOMETRIC_DEVICE_DELETE)
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION) // ✅ حماية حذف الجهاز
  @UseGuards(PermissionsGuard)
  removeDevice(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.attendanceService.removeDevice(id, user);
  }

  @Get('logs')
  @Permissions(PERMS.ATTENDANCE_LOGS_VIEW)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE) // ✅ سجلات الحضور جزء من موديول الحضور
  @UseGuards(PermissionsGuard)
  findLogs(
    @Query() query: AttendanceQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.findLogs(query, user);
  }

  @Get('logs/employee/:employeeId')
  @Permissions(PERMS.ATTENDANCE_LOGS_VIEW)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE) // ✅ حماية سجلات الموظف
  @UseGuards(PermissionsGuard)
  findEmployeeLogs(
    @Param('employeeId') id: string,
    @Query() q: AttendanceQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.findEmployeeLogs(id, q, user);
  }

  @Get('summary/daily')
  @Permissions(PERMS.ATTENDANCE_SUMMARY_VIEW)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE) // ✅ حماية الملخص اليومي
  @UseGuards(PermissionsGuard)
  getDailySummary(
    @Query('date') date: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.getDailySummary(date, user);
  }

  @Get('summary/employee/:employeeId/monthly')
  @Permissions(PERMS.ATTENDANCE_REPORTS_VIEW)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE) // ✅ حماية التقارير الشهرية
  @UseGuards(PermissionsGuard)
  getMonthlyReport(
    @Param('employeeId') id: string,
    @Query('month') m: string,
    @Query('year') y: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.getMonthlyReport(
      id,
      parseInt(m),
      parseInt(y),
      user,
    );
  }
}
