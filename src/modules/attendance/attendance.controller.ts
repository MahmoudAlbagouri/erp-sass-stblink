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
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { type CurrentUserData } from '../../common/decorators/current-user.decorator';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { AttendanceQueryDto } from './dto/attendance-query.dto';
// ✅ استيراد الثوابت
import { PERMS } from 'src/common/constants/permissions';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('devices')
  @Permissions(PERMS.BIOMETRIC_DEVICE_CREATE)
  @UseGuards(PermissionsGuard)
  createDevice(
    @Body() dto: CreateDeviceDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.createDevice(dto, user);
  }

  @Post('devices/:id/push-user/:employeeId')
  @Permissions(PERMS.BIOMETRIC_DEVICE_SYNC)
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
  @UseGuards(PermissionsGuard)
  findAllDevices(@CurrentUser() user: CurrentUserData) {
    return this.attendanceService.findAllDevices(user);
  }

  @Get('devices/:id')
  @Permissions(PERMS.BIOMETRIC_DEVICE_VIEW)
  @UseGuards(PermissionsGuard)
  findOneDevice(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.attendanceService.findOneDevice(id, user);
  }

  @Patch('devices/:id')
  @Permissions(PERMS.BIOMETRIC_DEVICE_UPDATE)
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
  @UseGuards(PermissionsGuard)
  removeDevice(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.attendanceService.removeDevice(id, user);
  }

  @Get('logs')
  @Permissions(PERMS.ATTENDANCE_LOGS_VIEW)
  @UseGuards(PermissionsGuard)
  findLogs(
    @Query() query: AttendanceQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.findLogs(query, user);
  }

  @Get('logs/employee/:employeeId')
  @Permissions(PERMS.ATTENDANCE_LOGS_VIEW)
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
  @UseGuards(PermissionsGuard)
  getDailySummary(
    @Query('date') date: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.getDailySummary(date, user);
  }

  @Get('summary/employee/:employeeId/monthly')
  @Permissions(PERMS.ATTENDANCE_REPORTS_VIEW)
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
