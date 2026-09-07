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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { CheckQuota } from '../../common/decorators/check-quota.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type CurrentUserData } from '../../common/decorators/current-user.decorator';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { AttendanceQueryDto } from './dto/attendance-query.dto';
import { UpdateAttendanceLogDto } from './dto/update-attendance-log.dto';
import { CreateManualAttendanceLogDto } from './dto/create-manual-attendance-log.dto';
import { PERMS } from 'src/common/constants/permissions';
import { FEATURES } from 'src/common/constants/features';

@Controller('attendance')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('devices')
  @Permissions(PERMS.BIOMETRIC_DEVICE_CREATE)
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION)
  @CheckQuota('max_biometric_devices')
  @UseGuards(PermissionsGuard)
  createDevice(
    @Body() dto: CreateDeviceDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.createDevice(dto, user);
  }

  @Post('devices/:id/push-user/:employeeId')
  @Permissions(PERMS.BIOMETRIC_DEVICE_SYNC)
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION)
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
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION)
  @UseGuards(PermissionsGuard)
  findAllDevices(@CurrentUser() user: CurrentUserData) {
    return this.attendanceService.findAllDevices(user);
  }

  @Get('devices/:id')
  @Permissions(PERMS.BIOMETRIC_DEVICE_VIEW)
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION)
  @UseGuards(PermissionsGuard)
  findOneDevice(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.attendanceService.findOneDevice(id, user);
  }

  @Patch('devices/:id')
  @Permissions(PERMS.BIOMETRIC_DEVICE_UPDATE)
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION)
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
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION)
  @UseGuards(PermissionsGuard)
  removeDevice(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.attendanceService.removeDevice(id, user);
  }

  // ══════════════ السجلات: عرض / إضافة يدوية / تعديل / تصدير ══════════════

  @Get('logs')
  @Permissions(PERMS.ATTENDANCE_LOGS_VIEW)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
  @UseGuards(PermissionsGuard)
  findLogs(
    @Query() query: AttendanceQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.findLogs(query, user);
  }

  // ⚠️ لازم تضيف PERMS.ATTENDANCE_LOGS_CREATE في ملف الصلاحيات عندك
  @Post('logs')
  @Permissions(PERMS.ATTENDANCE_LOGS_CREATE)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
  @UseGuards(PermissionsGuard)
  createManualLog(
    @Body() dto: CreateManualAttendanceLogDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.createManualLog(dto, user);
  }

  // ⚠️ لازم تضيف PERMS.ATTENDANCE_LOGS_UPDATE في ملف الصلاحيات عندك
  @Patch('logs/:id')
  @Permissions(PERMS.ATTENDANCE_LOGS_UPDATE)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
  @UseGuards(PermissionsGuard)
  updateLog(
    @Param('id') id: string,
    @Body() dto: UpdateAttendanceLogDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.updateLogTime(id, dto, user);
  }

  @Get('logs/export/:type')
  @Permissions(PERMS.ATTENDANCE_LOGS_VIEW)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
  @UseGuards(PermissionsGuard)
  async exportLogs(
    @Param('type') type: 'excel' | 'pdf',
    @Query() query: AttendanceQueryDto,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ) {
    const buffer = await this.attendanceService.exportLogs(query, type, user);

    if (type === 'excel') {
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=attendance_logs.xlsx',
      );
    } else {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=attendance_logs.pdf',
      );
    }
    res.send(buffer);
  }

  @Get('logs/employee/:employeeId')
  @Permissions(PERMS.ATTENDANCE_LOGS_VIEW)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
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
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
  @UseGuards(PermissionsGuard)
  getDailySummary(
    @Query('date') date: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.getDailySummary(date, user);
  }

  @Get('summary/employee/:employeeId/monthly')
  @Permissions(PERMS.ATTENDANCE_REPORTS_VIEW)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
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
