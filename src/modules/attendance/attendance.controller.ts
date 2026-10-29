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
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { apiTag } from '../../config/swagger.config';
import type { Request, Response } from 'express';
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
import { LinkPinDto } from './dto/link-pin.dto';
import { SyncUsersDto } from './dto/sync-users.dto';
import { ImportPunchesDto } from './dto/import-punches.dto';
import {
  AttendanceImportService,
  IMPORT_MAX_BYTES,
} from './attendance-import.service';
import { publicOrigin } from '../files/file-url.interceptor';
import { PERMS } from '../../common/constants/permissions';
import { FEATURES } from '../../common/constants/features';
import {
  assertReportFormat,
  sendReportBuffer,
} from '../../common/reports/report.service';

const importUpload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: IMPORT_MAX_BYTES, files: 1 },
});

@ApiTags(apiTag('ATTENDANCE'))
@Controller('attendance')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly importService: AttendanceImportService,
  ) {}

  /** إضافة جهاز بصمة */
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

  /** إرسال موظف (وبصماته المحفوظة) إلى جهاز ZKTeco ليُسجَّل عليه */
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

  /** إرسال كل الموظفين النشطين (وبصماتهم المحفوظة) لجهاز ZKTeco */
  @Post('devices/:id/sync-users')
  @Permissions(PERMS.BIOMETRIC_DEVICE_SYNC)
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION)
  @UseGuards(PermissionsGuard)
  syncAllUsers(
    @Param('id') id: string,
    @Body() dto: SyncUsersDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.syncAllUsersToDevice(
      id,
      dto.branchOnly ?? false,
      user,
    );
  }

  /** ما يُكتب في إعدادات الجهاز ليتصل بالسيرفر */
  @Get('devices/:id/setup')
  @Permissions(PERMS.BIOMETRIC_DEVICE_VIEW)
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION)
  @UseGuards(PermissionsGuard)
  deviceSetup(
    @Param('id') id: string,
    @Req() req: Request,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.attendanceService.deviceSetup(id, user, publicOrigin(req));
  }

  /** مفتاح إرسال جديد لجهاز Hikvision أو API (القديم يتوقف فوراً) */
  @Post('devices/:id/regenerate-key')
  @Permissions(PERMS.BIOMETRIC_DEVICE_UPDATE)
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION)
  @UseGuards(PermissionsGuard)
  regenerateKey(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.attendanceService.regeneratePushKey(id, user);
  }

  /** قائمة أجهزة البصمة وحالة اتصالها */
  @Get('devices')
  @Permissions(PERMS.BIOMETRIC_DEVICE_VIEW)
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION)
  @UseGuards(PermissionsGuard)
  findAllDevices(@CurrentUser() user: CurrentUserData) {
    return this.attendanceService.findAllDevices(user);
  }

  /** جهاز بصمة واحد */
  @Get('devices/:id')
  @Permissions(PERMS.BIOMETRIC_DEVICE_VIEW)
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION)
  @UseGuards(PermissionsGuard)
  findOneDevice(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.attendanceService.findOneDevice(id, user);
  }

  /** تعديل جهاز بصمة أو إيقافه */
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

  /** حذف جهاز بصمة (بصماته المسجّلة تبقى) */
  @Delete('devices/:id')
  @Permissions(PERMS.BIOMETRIC_DEVICE_DELETE)
  @RequiresFeature(FEATURES.BIOMETRIC_INTEGRATION)
  @UseGuards(PermissionsGuard)
  removeDevice(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    return this.attendanceService.removeDevice(id, user);
  }

  // ══════════════ السجلات: عرض / إضافة يدوية / تعديل / تصدير ══════════════

  /** سجلات الحضور والانصراف (مع فلترة وترقيم) */
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

  /** تسجيل بصمة يدوياً لموظف */
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

  /** تصحيح وقت بصمة أو نوعها */
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

  /** تصدير سجلات الحضور (excel أو pdf) */
  @Get('logs/export/:type')
  @Permissions(PERMS.ATTENDANCE_LOGS_VIEW)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
  @UseGuards(PermissionsGuard)
  async exportLogs(
    @Param('type') type: string,
    @Query() query: AttendanceQueryDto,
    @CurrentUser() user: CurrentUserData,
    @Res() res: Response,
  ) {
    assertReportFormat(type);
    const buffer = await this.attendanceService.exportLogs(query, type, user);
    sendReportBuffer(res, type, 'attendance_logs', buffer);
  }

  /** أرقام وصلت منها بصمات ولا يقابلها موظف */
  @Get('unlinked-pins')
  @Permissions(PERMS.ATTENDANCE_LOGS_VIEW)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
  @UseGuards(PermissionsGuard)
  findUnlinkedPins(@CurrentUser() user: CurrentUserData) {
    return this.attendanceService.findUnlinkedPins(user);
  }

  /** ربط رقم على الجهاز بموظف، ومعه كل البصمات التي وصلت به من قبل */
  @Post('unlinked-pins/link')
  @Permissions(PERMS.ATTENDANCE_LOGS_UPDATE)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
  @UseGuards(PermissionsGuard)
  linkPin(@Body() dto: LinkPinDto, @CurrentUser() user: CurrentUserData) {
    return this.attendanceService.linkPin(dto, user);
  }

  /** معاينة ملف بصمات (Excel/CSV): أعمدته وأول صفوفه وتخمين معانيها */
  @Post('import/preview')
  @ApiConsumes('multipart/form-data')
  @Permissions(PERMS.ATTENDANCE_LOGS_IMPORT)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
  @UseGuards(PermissionsGuard)
  @UseInterceptors(importUpload)
  previewImport(@UploadedFile() file?: Express.Multer.File) {
    return this.importService.preview(file);
  }

  /** استيراد بصمات من ملف صدّره برنامج أي جهاز بصمة */
  @Post('import')
  @ApiConsumes('multipart/form-data')
  @Permissions(PERMS.ATTENDANCE_LOGS_IMPORT)
  @RequiresFeature(FEATURES.ATTENDANCE_MODULE)
  @UseGuards(PermissionsGuard)
  @UseInterceptors(importUpload)
  importLogs(
    @Body() dto: ImportPunchesDto,
    @CurrentUser() user: CurrentUserData,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.importService.import(file, dto, user);
  }

  /** سجلات حضور موظف واحد */
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

  /** ملخص حضور يوم: حاضر، متأخر، غائب، في إجازة */
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

  /** تقرير حضور موظف لشهر */
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
