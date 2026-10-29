// src/modules/loans/loans.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
  NotFoundException,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import type { Response } from 'express';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { LoanStatus } from './entities/loan.entity';
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

@ApiTags(apiTag('LOANS'))
@Controller('loans')
@UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ تفعيل حراس الاشتراك والمصادقة
export class LoansController {
  constructor(
    private readonly loansService: LoansService,
    private readonly reportService: ReportService,
  ) {}

  /** طلب قرض للموظف الحالي */
  @Post('my-loans')
  @Permissions(PERMS.LOAN_REQUEST_SELF)
  @RequiresFeature(FEATURES.LOANS_MODULE) // ✅ التحقق من توفر الموديول
  @UseGuards(PermissionsGuard)
  createMyLoan(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateLoanDto,
  ) {
    if (!user.employeeId)
      throw new NotFoundException(
        'حسابك غير مرتبط بملف موظف، لا يمكنك طلب قرض',
      );
    return this.loansService.create(dto, user.employeeId, tenantId, user.id);
  }

  // ✅ مسار جديد: إنشاء قرض لموظف من قبل المدير
  /** تسجيل قرض لموظف (من الإدارة) */
  @Post('admin/:employeeId')
  @Permissions(PERMS.LOAN_CREATE_ADMIN)
  @RequiresFeature(FEATURES.LOANS_MODULE) // ✅ التحقق من توفر الموديول
  @UseGuards(PermissionsGuard)
  createForEmployee(
    @Param('employeeId') employeeId: string,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateLoanDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.loansService.create(dto, employeeId, tenantId, user.id);
  }

  // ✅ مسار التصدير الجماعي للقروض
  /** تصدير القروض (excel أو pdf) */
  @Get('export/:type')
  @Permissions(PERMS.LOAN_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportLoans(
    @Param('type') type: string,
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.loansService.findAll(tenantId);

    const columns = [
      { header: 'اسم الموظف', key: 'employeeName' },
      { header: 'إجمالي القرض', key: 'totalAmount' },
      { header: 'القسط الشهري', key: 'monthlyInstallment' },
      { header: 'عدد الأقساط الكلي', key: 'installmentsCount' },
      { header: 'الأقساط المسددة', key: 'paidInstallments' },
      { header: 'الأقساط المتبقية', key: 'remainingInstallments' },
      { header: 'الحالة', key: 'status' },
      { header: 'تاريخ البداية', key: 'startDate' },
      { header: 'السبب', key: 'reason' },
    ];

    const formattedData = data.map((l) => ({
      employeeName: l.employee?.fullName || '-',
      totalAmount: formatAmount(l.totalAmount),
      monthlyInstallment: formatAmount(l.monthlyInstallment),
      installmentsCount: l.installmentsCount,
      paidInstallments: l.paidInstallments || 0,
      remainingInstallments: l.installmentsCount - (l.paidInstallments || 0),
      status:
        String(l.status) === 'pending'
          ? 'معلق'
          : String(l.status) === 'approved'
            ? 'معتمد'
            : String(l.status) === 'rejected'
              ? 'مرفوض'
              : 'مكتمل',
      startDate: formatDate(l.startDate),
      reason: l.reason || '-',
    }));

    return this.reportService.sendReport(res, type, {
      rows: formattedData,
      columns,
      title: 'تقرير القروض',
      filename: 'loans',
    });
  }

  // ✅ مسار التصدير الفردي للقرض
  /** تصدير قرض واحد (excel أو pdf) */
  @Get(':id/export/:type')
  @Permissions(PERMS.LOAN_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportSingleLoan(
    @Param('id') id: string,
    @Param('type') type: string,
    @CurrentTenantId() tenantId: string,
    @CurrentCurrency() currency: string,
    @Res() res: Response,
  ) {
    const loan = await this.loansService.findOne(id, tenantId);

    const paid = loan.paidInstallments || 0;
    const remaining = loan.installmentsCount - paid;

    const reportData: ReportRow[] = [
      { label: 'اسم الموظف', value: loan.employee?.fullName || '-' },
      { label: 'كود الموظف', value: loan.employee?.employeeCode || '-' },
      { label: 'المسمى الوظيفي', value: loan.employee?.jobTitle || '-' },
      {
        label: 'إجمالي القرض',
        value: formatMoney(loan.totalAmount, currency),
      },
      {
        label: 'القسط الشهري',
        value: formatMoney(loan.monthlyInstallment, currency),
      },
      { label: 'عدد الأقساط الكلي', value: loan.installmentsCount },
      { label: 'الأقساط المسددة', value: paid },
      { label: 'الأقساط المتبقية', value: remaining },
      {
        label: 'نسبة السداد',
        value: `${Math.round((paid / loan.installmentsCount) * 100)}%`,
      },
      {
        label: 'الحالة',
        value:
          String(loan.status) === 'pending'
            ? 'معلق'
            : String(loan.status) === 'approved'
              ? 'معتمد'
              : String(loan.status) === 'rejected'
                ? 'مرفوض'
                : 'مكتمل',
      },
      {
        label: 'تاريخ بداية السداد',
        value: formatDate(loan.startDate),
      },
      { label: 'السبب', value: loan.reason || '-' },
    ];

    const columns = DETAIL_COLUMNS;

    return this.reportService.sendReport(res, type, {
      rows: reportData,
      columns,
      title: `قرض: ${loan.employee?.fullName}`,
      filename: `loan_${loan.employee?.employeeCode || id}`,
    });
  }

  /** قائمة القروض */
  @Get()
  @Permissions(PERMS.LOAN_VIEW)
  @RequiresFeature(FEATURES.LOANS_MODULE) // ✅ حماية عرض القائمة
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.loansService.findAll(tenantId);
  }

  /** تغيير حالة قرض (اعتماد أو رفض) */
  @Patch(':id/status')
  @Permissions(PERMS.LOAN_APPROVE)
  @RequiresFeature(FEATURES.LOANS_MODULE) // ✅ حماية الموافقة على القرض
  @UseGuards(PermissionsGuard)
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: LoanStatus,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.loansService.updateStatus(id, status, tenantId, user.id);
  }
}
