// src/modules/leaves/leaves.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  UseGuards,
  NotFoundException,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import type { Response } from 'express';
import { LeavesService } from './leaves.service';
import { LeaveCarryoverCronService } from './leave-carryover.cron.service';
import { CreateLeaveDto } from './dto/create-leave.dto';
import { SetLeaveBalanceDto } from './dto/set-leave-balance.dto';
import { calculateDurationDays } from '../../common/utils/date.utils';
import { LeaveStatus } from './entities/leave-request.entity';
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
import {
  DETAIL_COLUMNS,
  ReportService,
  type ReportRow,
} from '../../common/reports/report.service';
import { PERMS } from '../../common/constants/permissions';
import { formatDate } from '../../common/utils/format.util';
import { FEATURES } from '../../common/constants/features'; // ✅ استيراد الثوابت

@ApiTags(apiTag('LEAVES'))
@Controller('leaves')
@UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ تفعيل حراس الاشتراك والمصادقة
export class LeavesController {
  constructor(
    private readonly leavesService: LeavesService,
    private readonly carryoverCronService: LeaveCarryoverCronService,
    private readonly reportService: ReportService,
  ) {}

  /** طلب إجازة للموظف الحالي */
  @Post('my-leaves')
  @Permissions(PERMS.LEAVE_REQUEST_SELF)
  @RequiresFeature(FEATURES.LEAVES_MODULE) // ✅ التحقق من توفر الموديول
  @UseGuards(PermissionsGuard)
  createMyLeave(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateLeaveDto,
  ) {
    if (!user.employeeId)
      throw new NotFoundException('حسابك غير مرتبط بملف موظف');
    return this.leavesService.create(dto, user.employeeId, tenantId, user.id);
  }

  /** تفاصيل استحقاق إجازات موظف */
  @Get('accrual/:employeeId')
  @Permissions(PERMS.LEAVE_VIEW)
  @RequiresFeature(FEATURES.LEAVES_MODULE) // ✅ حماية عرض تفاصيل الاستحقاق
  @UseGuards(PermissionsGuard)
  async getAccrualDetails(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return await this.leavesService.getAccrualDetails(employeeId, tenantId);
  }

  // ✅ ملخص إجازات الموظف لصفحة "تفاصيل الموظف":
  // الفعلي المستهلك + كل الطلبات بأيامها + المتبقي
  /** ملخص إجازات موظف وأرصدته */
  @Get('summary/:employeeId')
  @Permissions(PERMS.LEAVE_VIEW)
  @RequiresFeature(FEATURES.LEAVES_MODULE)
  @UseGuards(PermissionsGuard)
  async getEmployeeLeaveSummary(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return await this.leavesService.getEmployeeLeaveSummary(
      employeeId,
      tenantId,
    );
  }

  /** تحديد رصيد إجازات موظف لسنة */
  @Post('balance')
  @Permissions(PERMS.LEAVE_BALANCE_MANAGE)
  @RequiresFeature(FEATURES.LEAVES_MODULE) // ✅ حماية إدارة الرصيد
  @UseGuards(PermissionsGuard)
  async setBalance(
    @Body() dto: SetLeaveBalanceDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return await this.leavesService.setBalance(dto, tenantId);
  }

  /** إعادة حساب الرصيد المرحَّل لموظف */
  @Post('carryover/recalculate/:employeeId')
  @Permissions(PERMS.LEAVE_BALANCE_MANAGE)
  @RequiresFeature(FEATURES.LEAVES_MODULE) // ✅ حماية إعادة حساب الترحيل
  @UseGuards(PermissionsGuard)
  recalculateCarryOverForEmployee(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.carryoverCronService.recalculateForEmployee(
      employeeId,
      tenantId,
    );
  }

  /** إعادة حساب الرصيد المرحَّل لكل الموظفين */
  @Post('carryover/recalculate-all')
  @Permissions(PERMS.LEAVE_BALANCE_MANAGE)
  @RequiresFeature(FEATURES.LEAVES_MODULE) // ✅ حماية إعادة حساب الترحيل للجميع
  @UseGuards(PermissionsGuard)
  recalculateCarryOverForAll(@CurrentTenantId() tenantId: string) {
    // ✅ على مستوى الشركة الحالية فقط (كان يعيد الحساب لكل الشركات)
    return this.carryoverCronService.recalculateAll(tenantId);
  }

  /** تسجيل إجازة لموظف (من الإدارة) */
  @Post('admin/:employeeId')
  @Permissions(PERMS.LEAVE_CREATE_ADMIN)
  @RequiresFeature(FEATURES.LEAVES_MODULE) // ✅ التحقق من توفر الموديول
  @UseGuards(PermissionsGuard)
  createForEmployee(
    @Param('employeeId') employeeId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateLeaveDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.leavesService.create(dto, employeeId, tenantId, user.id);
  }

  // ✅ مسار التصدير الجماعي للإجازات
  /** تصدير الإجازات (excel أو pdf) */
  @Get('export/:type')
  @Permissions(PERMS.LEAVE_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportLeaves(
    @Param('type') type: string,
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.leavesService.findAll(tenantId);

    const columns = [
      { header: 'اسم الموظف', key: 'employeeName' },
      { header: 'نوع الإجازة', key: 'type' },
      { header: 'تاريخ البداية', key: 'startDate' },
      { header: 'تاريخ النهاية', key: 'endDate' },
      { header: 'عدد الأيام', key: 'daysCount' },
      { header: 'الحالة', key: 'status' },
      { header: 'السبب', key: 'reason' },
      { header: 'تاريخ الطلب', key: 'createdAt' },
    ];

    const formattedData = data.map((req) => ({
      employeeName: req.employee?.fullName || '-',
      // ✅ الإصلاح: استخدام String() لتحويل الـ Enum إلى نص للمقارنة
      type:
        String(req.type) === 'annual'
          ? 'سنوية'
          : String(req.type) === 'unpaid'
            ? 'بدون راتب'
            : 'أخرى',
      startDate: formatDate(req.startDate),
      endDate: formatDate(req.endDate),
      daysCount: calculateDurationDays(req.startDate, req.endDate, true),
      // ✅ الإصلاح: استخدام String() للحالة أيضاً
      status:
        String(req.status) === 'pending'
          ? 'معلقة'
          : String(req.status) === 'approved'
            ? 'موافق عليها'
            : 'مرفوضة',
      reason: req.reason || '-',
      createdAt: formatDate(req.createdAt),
    }));

    return this.reportService.sendReport(res, type, {
      rows: formattedData,
      columns,
      title: 'تقرير الإجازات',
      filename: 'leaves',
    });
  }

  // ✅ مسار التصدير الفردي لإجازة واحدة
  /** تصدير إجازة واحدة (excel أو pdf) */
  @Get(':id/export/:type')
  @Permissions(PERMS.LEAVE_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportSingleLeave(
    @Param('id') id: string,
    @Param('type') type: string,
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const leave = await this.leavesService.findOne(id, tenantId);

    const daysCount = calculateDurationDays(
      leave.startDate,
      leave.endDate,
      true,
    );

    const reportData: ReportRow[] = [
      { label: 'اسم الموظف', value: leave.employee?.fullName || '-' },
      { label: 'كود الموظف', value: leave.employee?.employeeCode || '-' },
      { label: 'المسمى الوظيفي', value: leave.employee?.jobTitle || '-' },
      {
        label: 'نوع الإجازة',
        value:
          String(leave.type) === 'annual'
            ? 'سنوية'
            : String(leave.type) === 'unpaid'
              ? 'بدون راتب'
              : 'أخرى',
      },
      {
        label: 'تاريخ البداية',
        value: formatDate(leave.startDate),
      },
      {
        label: 'تاريخ النهاية',
        value: formatDate(leave.endDate),
      },
      { label: 'عدد الأيام', value: `${daysCount} يوم` },
      {
        label: 'الحالة',
        value:
          String(leave.status) === 'pending'
            ? 'معلقة'
            : String(leave.status) === 'approved'
              ? 'موافق عليها'
              : 'مرفوضة',
      },
      { label: 'السبب', value: leave.reason || '-' },
      {
        label: 'تاريخ تقديم الطلب',
        value: formatDate(leave.createdAt),
      },
    ];

    const columns = DETAIL_COLUMNS;

    return this.reportService.sendReport(res, type, {
      rows: reportData,
      columns,
      title: `طلب إجازة: ${leave.employee?.fullName}`,
      filename: `leave_${leave.employee?.employeeCode || id}`,
    });
  }

  /** قائمة طلبات الإجازة */
  @Get()
  @Permissions(PERMS.LEAVE_VIEW)
  @RequiresFeature(FEATURES.LEAVES_MODULE) // ✅ حماية عرض القائمة
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.leavesService.findAll(tenantId);
  }

  /** تغيير حالة طلب إجازة (اعتماد أو رفض) */
  @Patch(':id/status')
  @Permissions(PERMS.LEAVE_APPROVE)
  @RequiresFeature(FEATURES.LEAVES_MODULE) // ✅ حماية الموافقة على الإجازة
  @UseGuards(PermissionsGuard)
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: LeaveStatus,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.leavesService.updateStatus(id, status, tenantId, user.id);
  }
}
