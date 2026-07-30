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
  BadRequestException,
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
import { ReportService } from '../../common/reports/report.service';
import { PERMS } from '../../common/constants/permissions';
import { FEATURES } from '../../common/constants/features'; // ✅ استيراد الثوابت
import { DeductionStatus } from './entities/deduction.entity';

@Controller('deductions')
@UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ تفعيل حراس الاشتراك والمصادقة
export class DeductionsController {
  constructor(
    private readonly deductionsService: DeductionsService,
    private readonly reportService: ReportService,
  ) {}

  @Post()
  @Permissions(PERMS.DEDUCTION_CREATE)
  @RequiresFeature(FEATURES.DEDUCTIONS_MODULE || FEATURES.PAYROLL_MODULE) // ✅ التحقق من توفر الموديول
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
    @Param('type') type: 'excel' | 'pdf',
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
      totalAmount: Number(d.totalAmount).toLocaleString('ar-SA'),
      monthlyAmount: Number(d.monthlyAmount).toLocaleString('ar-SA'),
      installmentsCount: d.installmentsCount,
      paymentsStatus: `${d.paidInstallments} / ${d.installmentsCount}`,
      startDate: new Date(d.startDate).toLocaleDateString('ar-SA'),
      notes: d.notes || '-',
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
        'attachment; filename=deductions.xlsx',
      );
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        formattedData,
        columns,
        'تقرير الخصومات',
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=deductions.pdf',
      );
      return res.send(buffer);
    }
  }

  // ✅ مسار التصدير الفردي للخصم
  @Get(':id/export/:type')
  @Permissions(PERMS.DEDUCTION_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportSingleDeduction(
    @Param('id') id: string,
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const deduction = await this.deductionsService.findOne(id, tenantId);
    if (!deduction) throw new BadRequestException('الخصم غير موجود');

    const reportData: any[] = [
      { label: 'اسم الموظف', value: deduction.employee?.fullName || '-' },
      { label: 'كود الموظف', value: deduction.employee?.employeeCode || '-' },
      { label: 'المسمى الوظيفي', value: deduction.employee?.jobTitle || '-' },
      { label: 'نوع الخصم', value: deduction.name },
      { label: 'الحالة', value: this.getStatusLabel(deduction.status) },
      {
        label: 'إجمالي المبلغ',
        value: `${Number(deduction.totalAmount).toLocaleString('ar-SA')} ر.س`,
      },
      {
        label: 'القسط الشهري',
        value: `${Number(deduction.monthlyAmount).toLocaleString('ar-SA')} ر.س`,
      },
      { label: 'عدد الدفعات الكلي', value: deduction.installmentsCount },
      { label: 'الدفعات المسددة', value: deduction.paidInstallments },
      {
        label: 'الدفعات المتبقية',
        value: deduction.installmentsCount - deduction.paidInstallments,
      },
      {
        label: 'تاريخ بدء الخصم',
        value: new Date(deduction.startDate).toLocaleDateString('ar-SA'),
      },
      { label: 'ملاحظات', value: deduction.notes || '-' },
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
        `attachment; filename=deduction_${deduction.employee?.employeeCode || id}.xlsx`,
      );
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        reportData,
        columns,
        `خصم: ${deduction.employee?.fullName}`,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=deduction_${deduction.employee?.employeeCode || id}.pdf`,
      );
      return res.send(buffer);
    }

    throw new BadRequestException('نوع التصدير غير مدعوم');
  }

  @Get()
  @Permissions(PERMS.DEDUCTION_VIEW)
  @RequiresFeature(FEATURES.DEDUCTIONS_MODULE || FEATURES.PAYROLL_MODULE) // ✅ حماية عرض القائمة
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.deductionsService.findAll(tenantId);
  }

  @Get(':id')
  @Permissions(PERMS.DEDUCTION_VIEW)
  @RequiresFeature(FEATURES.DEDUCTIONS_MODULE || FEATURES.PAYROLL_MODULE) // ✅ حماية عرض التفاصيل
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.deductionsService.findOne(id, tenantId);
  }

  @Patch(':id')
  @Permissions(PERMS.DEDUCTION_UPDATE)
  @RequiresFeature(FEATURES.DEDUCTIONS_MODULE || FEATURES.PAYROLL_MODULE) // ✅ حماية التعديل
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
  @RequiresFeature(FEATURES.DEDUCTIONS_MODULE || FEATURES.PAYROLL_MODULE) // ✅ حماية تغيير الحالة
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
  @RequiresFeature(FEATURES.DEDUCTIONS_MODULE || FEATURES.PAYROLL_MODULE) // ✅ حماية الحذف
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
