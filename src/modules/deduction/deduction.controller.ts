// src/modules/deductions/deductions.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { DeductionsService } from './deduction.service';
import { CreateDeductionDto } from './dto/create-deduction.dto';
import { UpdateDeductionDto } from './dto/update-deduction.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard'; // ✅ استيراد الحارس
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator'; // ✅ استيراد ديكوراتور الميزة
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { CurrentCurrency } from '../../common/decorators/current-currency.decorator';
import {
  DETAIL_COLUMNS,
  ReportService,
  type ReportRow,
} from '../../common/reports/report.service';
import { PERMS } from '../../common/constants/permissions';
import { FEATURES } from '../../common/constants/features'; // ✅ استيراد الثوابت
import { DeductionStatus } from './entities/deduction.entity';
import {
  formatAmount,
  formatDate,
  formatMoney,
} from '../../common/utils/format.util';

@Controller('deductions')
@UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ تفعيل حراس الاشتراك والمصادقة
export class DeductionsController {
  constructor(
    private readonly deductionsService: DeductionsService,
    private readonly reportService: ReportService,
  ) {}

  @Post()
  @Permissions(PERMS.DEDUCTION_CREATE)
  @RequiresFeature(FEATURES.DEDUCTIONS_MODULE) // ✅ التحقق من توفر الموديول
  @UseGuards(PermissionsGuard)
  create(@Body() dto: CreateDeductionDto, @CurrentTenantId() tenantId: string) {
    return this.deductionsService.create(dto, tenantId);
  }

  // ✅ مسار التصدير الجماعي للخصومات
  @Get('export/:type')
  @Permissions(PERMS.DEDUCTION_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportDeductions(
    @Param('type') type: string,
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.deductionsService.findAll(tenantId);

    const columns = [
      { header: 'اسم الموظف', key: 'employeeName' },
      { header: 'نوع الخصم', key: 'name' },
      { header: 'الحالة', key: 'status' },
      { header: 'إجمالي المبلغ', key: 'totalAmount' },
      { header: 'القسط الشهري', key: 'monthlyAmount' },
      { header: 'عدد الدفعات', key: 'installmentsCount' },
      { header: 'المدفوع / المتبقي', key: 'paymentsStatus' },
      { header: 'تاريخ البدء', key: 'startDate' },
      { header: 'ملاحظات', key: 'notes' },
    ];

    const formattedData = data.map((d) => ({
      employeeName: d.employee?.fullName || '-',
      name: d.name,
      status: this.getStatusLabel(d.status),
      totalAmount: formatAmount(d.totalAmount),
      monthlyAmount: formatAmount(d.monthlyAmount),
      installmentsCount: d.installmentsCount,
      paymentsStatus: `${d.paidInstallments} / ${d.installmentsCount}`,
      startDate: formatDate(d.startDate),
      notes: d.notes || '-',
    }));

    return this.reportService.sendReport(res, type, {
      rows: formattedData,
      columns,
      title: 'تقرير الخصومات',
      filename: 'deductions',
    });
  }

  // ✅ مسار التصدير الفردي للخصم
  @Get(':id/export/:type')
  @Permissions(PERMS.DEDUCTION_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportSingleDeduction(
    @Param('id') id: string,
    @Param('type') type: string,
    @CurrentTenantId() tenantId: string,
    @CurrentCurrency() currency: string,
    @Res() res: Response,
  ) {
    const deduction = await this.deductionsService.findOne(id, tenantId);

    const reportData: ReportRow[] = [
      { label: 'اسم الموظف', value: deduction.employee?.fullName || '-' },
      { label: 'كود الموظف', value: deduction.employee?.employeeCode || '-' },
      { label: 'المسمى الوظيفي', value: deduction.employee?.jobTitle || '-' },
      { label: 'نوع الخصم', value: deduction.name },
      { label: 'الحالة', value: this.getStatusLabel(deduction.status) },
      {
        label: 'إجمالي المبلغ',
        value: formatMoney(deduction.totalAmount, currency),
      },
      {
        label: 'القسط الشهري',
        value: formatMoney(deduction.monthlyAmount, currency),
      },
      { label: 'عدد الدفعات الكلي', value: deduction.installmentsCount },
      { label: 'الدفعات المسددة', value: deduction.paidInstallments },
      {
        label: 'الدفعات المتبقية',
        value: deduction.installmentsCount - deduction.paidInstallments,
      },
      {
        label: 'تاريخ بدء الخصم',
        value: formatDate(deduction.startDate),
      },
      { label: 'ملاحظات', value: deduction.notes || '-' },
    ];

    const columns = DETAIL_COLUMNS;

    return this.reportService.sendReport(res, type, {
      rows: reportData,
      columns,
      title: `خصم: ${deduction.employee?.fullName}`,
      filename: `deduction_${deduction.employee?.employeeCode || id}`,
    });
  }

  @Get()
  @Permissions(PERMS.DEDUCTION_VIEW)
  @RequiresFeature(FEATURES.DEDUCTIONS_MODULE) // ✅ حماية عرض القائمة
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.deductionsService.findAll(tenantId);
  }

  @Get(':id')
  @Permissions(PERMS.DEDUCTION_VIEW)
  @RequiresFeature(FEATURES.DEDUCTIONS_MODULE) // ✅ حماية عرض التفاصيل
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.deductionsService.findOne(id, tenantId);
  }

  @Patch(':id')
  @Permissions(PERMS.DEDUCTION_UPDATE)
  @RequiresFeature(FEATURES.DEDUCTIONS_MODULE) // ✅ حماية التعديل
  @UseGuards(PermissionsGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDeductionDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.deductionsService.update(id, dto, tenantId);
  }

  // ✅ Endpoint جديد لتغيير حالة الخصم
  @Patch(':id/status')
  @Permissions(PERMS.DEDUCTION_UPDATE)
  @RequiresFeature(FEATURES.DEDUCTIONS_MODULE) // ✅ حماية تغيير الحالة
  @UseGuards(PermissionsGuard)
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: DeductionStatus,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.deductionsService.updateStatus(id, status, tenantId);
  }

  @Delete(':id')
  @Permissions(PERMS.DEDUCTION_DELETE)
  @RequiresFeature(FEATURES.DEDUCTIONS_MODULE) // ✅ حماية الحذف
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.deductionsService.remove(id, tenantId);
  }

  // ✅ دالة مساعدة لترجمة الحالة
  private getStatusLabel(status: DeductionStatus): string {
    switch (status) {
      case DeductionStatus.PENDING:
        return 'معلق';
      case DeductionStatus.ACTIVE:
        return 'نشط';
      case DeductionStatus.COMPLETED:
        return 'مكتمل';
      case DeductionStatus.CANCELLED:
        return 'ملغي';
      default:
        return status;
    }
  }
}
