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
import { CurrentCurrency } from '../../common/decorators/current-currency.decorator';
import {
  DETAIL_COLUMNS,
  ReportService,
  type ReportRow,
} from '../../common/reports/report.service';
import { PERMS } from '../../common/constants/permissions';
import {
  formatAmount,
  formatDate,
  formatMoney,
} from '../../common/utils/format.util';
import { FEATURES } from '../../common/constants/features'; // ✅ استيراد الثوابت

@Controller('advances')
@UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ تفعيل حراس الاشتراك والمصادقة
export class AdvancesController {
  constructor(
    private readonly advancesService: AdvancesService,
    private readonly reportService: ReportService,
  ) {}

  @Patch(':id/disburse')
  @Permissions(PERMS.ADVANCE_APPROVE)
  @RequiresFeature(FEATURES.ADVANCES_MODULE)
  @UseGuards(PermissionsGuard)
  async disburse(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.advancesService.disburseAdvance(id, user.tenantId, user.id);
  }

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
    @Param('type') type: string,
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
      amount: formatAmount(adv.amount),
      reason: adv.reason || '-',
      repaymentDate: adv.repaymentDate ? formatDate(adv.repaymentDate) : '-',
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
      createdAt: formatDate(adv.createdAt),
    }));

    return this.reportService.sendReport(res, type, {
      rows: formattedData,
      columns,
      title: 'تقرير السلف',
      filename: 'advances',
    });
  }

  // ✅ مسار التصدير الفردي لسلفة واحدة
  @Get(':id/export/:type')
  @Permissions(PERMS.ADVANCE_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportSingleAdvance(
    @Param('id') id: string,
    @Param('type') type: string,
    @CurrentTenantId() tenantId: string,
    @CurrentCurrency() currency: string,
    @Res() res: Response,
  ) {
    const advance = await this.advancesService.findOne(id, tenantId);

    const reportData: ReportRow[] = [
      { label: 'اسم الموظف', value: advance.employee?.fullName || '-' },
      { label: 'كود الموظف', value: advance.employee?.employeeCode || '-' },
      { label: 'المسمى الوظيفي', value: advance.employee?.jobTitle || '-' },
      {
        label: 'المبلغ',
        value: formatMoney(advance.amount, currency),
      },
      { label: 'السبب', value: advance.reason || '-' },
      {
        label: 'تاريخ السداد',
        value: advance.repaymentDate
          ? formatDate(advance.repaymentDate)
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
        value: formatDate(advance.createdAt),
      },
    ];

    const columns = DETAIL_COLUMNS;

    return this.reportService.sendReport(res, type, {
      rows: reportData,
      columns,
      title: `سلفة: ${advance.employee?.fullName}`,
      filename: `advance_${advance.employee?.employeeCode || id}`,
    });
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
