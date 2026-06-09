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
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { AttendanceQueryDto } from './dto/attendance-query.dto';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  // ──────────────────── إدارة الأجهزة ────────────────────

  @Post('devices')
  @Permissions('create_biometric_device')
  @UseGuards(PermissionsGuard)
  createDevice(@Body() dto: CreateDeviceDto) {
    return this.attendanceService.createDevice(dto);
  }

  // ✅ Endpoint جديدة لإرسال بيانات الموظف للجهاز
  @Post('devices/:id/push-user')
  @Permissions('update_biometric_device')
  @UseGuards(PermissionsGuard)
  pushUserToDevice(
    @Param('id') deviceId: string,
    @Body() employeeData: { pin: string; name: string },
  ) {
    return this.attendanceService.pushUserToDevice(deviceId, employeeData);
  }

  @Get('devices')
  @Permissions('view_biometric_devices')
  @UseGuards(PermissionsGuard)
  findAllDevices() {
    return this.attendanceService.findAllDevices();
  }

  @Get('devices/:id')
  @Permissions('view_biometric_devices')
  @UseGuards(PermissionsGuard)
  findOneDevice(@Param('id') id: string) {
    return this.attendanceService.findOneDevice(id);
  }

  @Patch('devices/:id')
  @Permissions('update_biometric_device')
  @UseGuards(PermissionsGuard)
  updateDevice(@Param('id') id: string, @Body() dto: UpdateDeviceDto) {
    return this.attendanceService.updateDevice(id, dto);
  }

  @Delete('devices/:id')
  @Permissions('delete_biometric_device')
  @UseGuards(PermissionsGuard)
  removeDevice(@Param('id') id: string) {
    return this.attendanceService.removeDevice(id);
  }

  // ──────────────────── سجلات الحضور ────────────────────

  @Get('logs')
  @Permissions('view_attendance_logs')
  @UseGuards(PermissionsGuard)
  findLogs(@Query() query: AttendanceQueryDto) {
    return this.attendanceService.findLogs(query);
  }

  @Get('logs/employee/:employeeId')
  @Permissions('view_attendance_logs')
  @UseGuards(PermissionsGuard)
  findEmployeeLogs(
    @Param('employeeId') employeeId: string,
    @Query() query: AttendanceQueryDto,
  ) {
    return this.attendanceService.findEmployeeLogs(employeeId, query);
  }

  @Get('summary/daily')
  @Permissions('view_attendance_logs')
  @UseGuards(PermissionsGuard)
  getDailySummary(@Query('date') date: string) {
    return this.attendanceService.getDailySummary(date);
  }

  @Get('summary/employee/:employeeId/monthly')
  @Permissions('view_attendance_logs')
  @UseGuards(PermissionsGuard)
  getMonthlyReport(
    @Param('employeeId') employeeId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.attendanceService.getMonthlyReport(
      employeeId,
      parseInt(month, 10),
      parseInt(year, 10),
    );
  }
}
