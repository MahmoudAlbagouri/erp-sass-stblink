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
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { LeavesService } from './leaves.service';
import { LeaveCarryoverCronService } from './leave-carryover.cron.service';
import { CreateLeaveDto } from './dto/create-leave.dto';
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
import { ReportService } from '../../common/reports/report.service';
import { PERMS } from 'src/common/constants/permissions';
import { FEATURES } from 'src/common/constants/features'; // ✅ استيراد الثوابت

@Controller('leaves')
@UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ تفعيل حراس الاشتراك والمصادقة
export class LeavesController {
  constructor(
    private readonly leavesService: LeavesService,
    private readonly carryoverCronService: LeaveCarryoverCronService,
    private readonly reportService: ReportService,
  ) {}

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
    return this.leavesService.create(dto, user.employeeId, tenantId);
  }

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

  @Post('balance')
  @Permissions(PERMS.LEAVE_BALANCE_MANAGE)
  @RequiresFeature(FEATURES.LEAVES_MODULE) // ✅ حماية إدارة الرصيد
  @UseGuards(PermissionsGuard)
  async setBalance(
    @Body() dto: { employeeId: string; year: number; amount: number },
    @CurrentTenantId() tenantId: string,
  ) {
    return await this.leavesService.setBalance(dto, tenantId);
  }

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

  @Post('carryover/recalculate-all')
  @Permissions(PERMS.LEAVE_BALANCE_MANAGE)
  @RequiresFeature(FEATURES.LEAVES_MODULE) // ✅ حماية إعادة حساب الترحيل للجميع
  @UseGuards(PermissionsGuard)
  recalculateCarryOverForAll() {
    return this.carryoverCronService.recalculateAll();
  }

  @Post('admin/:employeeId')
  @Permissions(PERMS.LEAVE_CREATE_ADMIN)
  @RequiresFeature(FEATURES.LEAVES_MODULE) // ✅ التحقق من توفر الموديول
  @UseGuards(PermissionsGuard)
  createForEmployee(
    @Param('employeeId') employeeId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateLeaveDto,
  ) {
    return this.leavesService.create(dto, employeeId, tenantId);
  }

  // ✅ مسار التصدير الجماعي للإجازات
  @Get('export/:type')
  @Permissions(PERMS.LEAVE_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportLeaves(
    @Param('type') type: 'excel' | 'pdf',
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
      startDate: new Date(req.startDate).toLocaleDateString('ar-SA'),
      endDate: new Date(req.endDate).toLocaleDateString('ar-SA'),
      daysCount:
        Math.ceil(
          Math.abs(
            new Date(req.endDate).getTime() - new Date(req.startDate).getTime(),
          ) /
            (1000 * 60 * 60 * 24),
        ) + 1,
      // ✅ الإصلاح: استخدام String() للحالة أيضاً
      status:
        String(req.status) === 'pending'
          ? 'معلقة'
          : String(req.status) === 'approved'
            ? 'موافق عليها'
            : 'مرفوضة',
      reason: req.reason || '-',
      createdAt: new Date(req.createdAt).toLocaleDateString('ar-SA'),
    }));

    if (type === 'excel') {
      const buffer = await this.reportService.generateExcel(
        formattedData,
        columns,
      );
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', 'attachment; filename=leaves.xlsx');
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        formattedData,
        columns,
        'تقرير الإجازات',
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=leaves.pdf');
      return res.send(buffer);
    }
  }

  // ✅ مسار التصدير الفردي لإجازة واحدة
  @Get(':id/export/:type')
  @Permissions(PERMS.LEAVE_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportSingleLeave(
    @Param('id') id: string,
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const leave = await this.leavesService.findOne(id, tenantId);
    if (!leave) throw new BadRequestException('طلب الإجازة غير موجود');

    const daysCount =
      Math.ceil(
        Math.abs(
          new Date(leave.endDate).getTime() -
            new Date(leave.startDate).getTime(),
        ) /
          (1000 * 60 * 60 * 24),
      ) + 1;

    const reportData: any[] = [
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
        value: new Date(leave.startDate).toLocaleDateString('ar-SA'),
      },
      {
        label: 'تاريخ النهاية',
        value: new Date(leave.endDate).toLocaleDateString('ar-SA'),
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
        value: new Date(leave.createdAt).toLocaleDateString('ar-SA'),
      },
    ];

    const columns = [
      { header: 'البيان', key: 'label' },
      { header: 'القيمة', key: 'value' },
    ];

    if (type === 'excel') {
      const buffer = await this.reportService.generateExcel(
        reportData,
        columns,
      );
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=leave_${leave.employee?.employeeCode || id}.xlsx`,
      );
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        reportData,
        columns,
        `طلب إجازة: ${leave.employee?.fullName}`,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=leave_${leave.employee?.employeeCode || id}.pdf`,
      );
      return res.send(buffer);
    }

    throw new BadRequestException('نوع التصدير غير مدعوم');
  }

  @Get()
  @Permissions(PERMS.LEAVE_VIEW)
  @RequiresFeature(FEATURES.LEAVES_MODULE) // ✅ حماية عرض القائمة
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.leavesService.findAll(tenantId);
  }

  @Patch(':id/status')
  @Permissions(PERMS.LEAVE_APPROVE)
  @RequiresFeature(FEATURES.LEAVES_MODULE) // ✅ حماية الموافقة على الإجازة
  @UseGuards(PermissionsGuard)
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: LeaveStatus,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.leavesService.updateStatus(id, status, tenantId);
  }
}
