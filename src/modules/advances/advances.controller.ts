// src/modules/advances/advances.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  UseGuards,
  NotFoundException,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdvancesService } from './advances.service';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { AdvanceStatus } from './entities/advance.entity';
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

@Controller('advances')
@UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ تفعيل حراس الاشتراك والمصادقة
export class AdvancesController {
  constructor(
    private readonly advancesService: AdvancesService,
    private readonly reportService: ReportService,
  ) {}

  @Post('my-advances')
  @Permissions(PERMS.ADVANCE_REQUEST_SELF)
  @RequiresFeature(FEATURES.ADVANCES_MODULE) // ✅ التحقق من توفر الموديول
  @UseGuards(PermissionsGuard)
  createMyAdvance(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateAdvanceDto,
  ) {
    if (!user.employeeId)
      throw new NotFoundException('حسابك غير مرتبط بملف موظف');
    return this.advancesService.create(dto, user.employeeId, tenantId);
  }

  @Post('admin/:employeeId')
  @Permissions(PERMS.ADVANCE_CREATE_ADMIN)
  @RequiresFeature(FEATURES.ADVANCES_MODULE) // ✅ التحقق من توفر الموديول
  @UseGuards(PermissionsGuard)
  createForEmployee(
    @Param('employeeId') employeeId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateAdvanceDto,
  ) {
    return this.advancesService.create(dto, employeeId, tenantId);
  }

  // ✅ مسار التصدير الجماعي للسلف
  @Get('export/:type')
  @Permissions(PERMS.ADVANCE_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportAdvances(
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.advancesService.findAll(tenantId);

    const columns = [
      { header: 'اسم الموظف', key: 'employeeName' },
      { header: 'المبلغ', key: 'amount' },
      { header: 'السبب', key: 'reason' },
      { header: 'تاريخ السداد', key: 'repaymentDate' },
      { header: 'الحالة', key: 'status' },
      { header: 'تاريخ الطلب', key: 'createdAt' },
    ];

    const formattedData = data.map((adv) => ({
      employeeName: adv.employee?.fullName || '-',
      amount: Number(adv.amount).toLocaleString('ar-SA'),
      reason: adv.reason || '-',
      repaymentDate: adv.repaymentDate
        ? new Date(adv.repaymentDate).toLocaleDateString('ar-SA')
        : '-',
      // ✅ الإصلاح: استخدام String() لتجنب خطأ enum comparison
      status:
        String(adv.status) === 'pending'
          ? 'معلقة'
          : String(adv.status) === 'approved'
            ? 'معتمدة'
            : String(adv.status) === 'rejected'
              ? 'مرفوضة'
              : String(adv.status) === 'paid'
                ? 'مدفوعة'
                : '-',
      createdAt: new Date(adv.createdAt).toLocaleDateString('ar-SA'),
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
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=advances.xlsx',
      );
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        formattedData,
        columns,
        'تقرير السلف',
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=advances.pdf');
      return res.send(buffer);
    }
  }

  // ✅ مسار التصدير الفردي لسلفة واحدة
  @Get(':id/export/:type')
  @Permissions(PERMS.ADVANCE_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportSingleAdvance(
    @Param('id') id: string,
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const advance = await this.advancesService.findOne(id, tenantId);
    if (!advance) throw new BadRequestException('السلفة غير موجودة');

    const reportData: any[] = [
      { label: 'اسم الموظف', value: advance.employee?.fullName || '-' },
      { label: 'كود الموظف', value: advance.employee?.employeeCode || '-' },
      { label: 'المسمى الوظيفي', value: advance.employee?.jobTitle || '-' },
      {
        label: 'المبلغ',
        value: `${Number(advance.amount).toLocaleString('ar-SA')} ر.س`,
      },
      { label: 'السبب', value: advance.reason || '-' },
      {
        label: 'تاريخ السداد',
        value: advance.repaymentDate
          ? new Date(advance.repaymentDate).toLocaleDateString('ar-SA')
          : 'غير محدد',
      },
      {
        label: 'الحالة',
        value:
          String(advance.status) === 'pending'
            ? 'معلقة'
            : String(advance.status) === 'approved'
              ? 'معتمدة'
              : String(advance.status) === 'rejected'
                ? 'مرفوضة'
                : String(advance.status) === 'paid'
                  ? 'مدفوعة'
                  : '-',
      },
      {
        label: 'تاريخ الطلب',
        value: new Date(advance.createdAt).toLocaleDateString('ar-SA'),
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
        `attachment; filename=advance_${advance.employee?.employeeCode || id}.xlsx`,
      );
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        reportData,
        columns,
        `سلفة: ${advance.employee?.fullName}`,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=advance_${advance.employee?.employeeCode || id}.pdf`,
      );
      return res.send(buffer);
    }

    throw new BadRequestException('نوع التصدير غير مدعوم');
  }

  @Get()
  @Permissions(PERMS.ADVANCE_VIEW)
  @RequiresFeature(FEATURES.ADVANCES_MODULE) // ✅ حماية عرض القائمة
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.advancesService.findAll(tenantId);
  }

  @Patch(':id/status')
  @Permissions(PERMS.ADVANCE_APPROVE)
  @RequiresFeature(FEATURES.ADVANCES_MODULE) // ✅ حماية الموافقة
  @UseGuards(PermissionsGuard)
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: AdvanceStatus,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.advancesService.updateStatus(id, status, tenantId);
  }
}
