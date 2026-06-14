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

interface PushUserToDeviceDto {
  pin: string;
  name: string;
}

@Controller('attendance')
@UseGuards(JwtAuthGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('devices')
  @Permissions('create_biometric_device')
  @UseGuards(PermissionsGuard)
  createDevice(
    @Body() dto: CreateDeviceDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.createDevice(dto, user);
  }

  @Post('devices/:id/push-user')
  @Permissions('update_biometric_device')
  @UseGuards(PermissionsGuard)
  pushUserToDevice(
    @Param('id') id: string,
    @Body() data: PushUserToDeviceDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.pushUserToDevice(id, data, user);
  }

  @Get('devices')
  @Permissions('view_biometric_devices')
  @UseGuards(PermissionsGuard)
  findAllDevices(@CurrentUser() user: CurrentUserData) {
    return this.attendanceService.findAllDevices(user);
  }

  @Get('devices/:id')
  @Permissions('view_biometric_devices')
  @UseGuards(PermissionsGuard)
  findOneDevice(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.attendanceService.findOneDevice(id, user);
  }

  @Patch('devices/:id')
  @Permissions('update_biometric_device')
  @UseGuards(PermissionsGuard)
  updateDevice(
    @Param('id') id: string,
    @Body() dto: UpdateDeviceDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.updateDevice(id, dto, user);
  }

  @Delete('devices/:id')
  @Permissions('delete_biometric_device')
  @UseGuards(PermissionsGuard)
  removeDevice(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.attendanceService.removeDevice(id, user);
  }

  @Get('logs')
  @Permissions('view_attendance_logs')
  @UseGuards(PermissionsGuard)
  findLogs(
    @Query() query: AttendanceQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.findLogs(query, user);
  }

  @Get('logs/employee/:employeeId')
  @Permissions('view_attendance_logs')
  @UseGuards(PermissionsGuard)
  findEmployeeLogs(
    @Param('employeeId') id: string,
    @Query() q: AttendanceQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.findEmployeeLogs(id, q, user);
  }

  @Get('summary/daily')
  @Permissions('view_attendance_logs')
  @UseGuards(PermissionsGuard)
  getDailySummary(
    @Query('date') date: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.getDailySummary(date, user);
  }

  @Get('summary/employee/:employeeId/monthly')
  @Permissions('view_attendance_logs')
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
