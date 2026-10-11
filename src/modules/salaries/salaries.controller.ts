// src/modules/salaries/salaries.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { SalariesService } from './salaries.service';
import { CreateSalaryDto } from './dto/create-salary.dto';
import { UpdateSalaryDto } from './dto/update-salary.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard'; // ✅ استيراد الحارس
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator'; // ✅ استيراد ديكوراتور الميزة
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import {
  DETAIL_COLUMNS,
  ReportService,
  type ReportRow,
} from '../../common/reports/report.service';
import { PERMS } from '../../common/constants/permissions';
import { formatAmount, formatDate } from '../../common/utils/format.util';
import { FEATURES } from '../../common/constants/features'; // ✅ استيراد الثوابت

@Controller('salaries')
@UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ تفعيل حراس الاشتراك والمصادقة
export class SalariesController {
  constructor(
    private readonly salariesService: SalariesService,
    private readonly reportService: ReportService,
  ) {}

  @Post()
  @Permissions(PERMS.SALARY_MANAGE)
  @RequiresFeature(FEATURES.EMPLOYEES_MODULE) // ✅ الراتب جزء من موديول الموظفين الأساسي
  @UseGuards(PermissionsGuard)
  create(@Body() dto: CreateSalaryDto, @CurrentTenantId() tenantId: string) {
    return this.salariesService.create(dto, tenantId);
  }

  // ✅ مسار التصدير الجماعي
  @Get('export/:type')
  @Permissions(PERMS.SALARY_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportSalaries(
    @Param('type') type: string,
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.salariesService.findAll(tenantId);

    const columns = [
      { header: 'اسم الموظف', key: 'employeeName' },
      { header: 'كود الموظف', key: 'employeeCode' },
      { header: 'الأجر الأساسي', key: 'basicSalary' },
      { header: 'بدل السكن', key: 'housingAllowance' },
      { header: 'بدل النقل', key: 'transportAllowance' },
      { header: 'بدلات أخرى', key: 'otherAllowances' },
      { header: 'الإجمالي', key: 'totalSalary' },
    ];

    const formattedData = data.map((sal) => ({
      employeeName: sal.employee?.fullName || '-',
      employeeCode: sal.employee?.employeeCode || '-',
      basicSalary: formatAmount(sal.basicSalary),
      housingAllowance: formatAmount(sal.housingAllowance),
      transportAllowance: formatAmount(sal.transportAllowance),
      otherAllowances: formatAmount(sal.otherAllowances),
      totalSalary: formatAmount(sal.totalSalary),
    }));

    return this.reportService.sendReport(res, type, {
      rows: formattedData,
      columns,
      title: 'تقرير الرواتب',
      filename: 'salaries',
    });
  }

  // ✅ مسار التصدير الفردي (يجب أن يكون قبل findOne)
  @Get(':id/export/:type')
  @Permissions(PERMS.SALARY_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportSingleSalary(
    @Param('id') id: string,
    @Param('type') type: string,
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const salary = await this.salariesService.findOne(id, tenantId);

    const reportData: ReportRow[] = [
      { label: 'اسم الموظف', value: salary.employee?.fullName || '-' },
      { label: 'كود الموظف', value: salary.employee?.employeeCode || '-' },
      { label: 'المسمى الوظيفي', value: salary.employee?.jobTitle || '-' },
      { label: 'القسم', value: salary.employee?.department?.name || '-' },
      {
        label: 'الأجر الأساسي',
        value: `${formatAmount(salary.basicSalary)} ر.س`,
      },
      {
        label: 'بدل السكن',
        value: `${formatAmount(salary.housingAllowance)} ر.س`,
      },
      {
        label: 'بدل النقل',
        value: `${formatAmount(salary.transportAllowance)} ر.س`,
      },
      {
        label: 'بدلات أخرى',
        value: `${formatAmount(salary.otherAllowances)} ر.س`,
      },
      {
        label: 'إجمالي الراتب',
        value: `${formatAmount(salary.totalSalary)} ر.س`,
      },
      {
        label: 'تاريخ آخر تحديث',
        value: formatDate(salary.updatedAt || salary.createdAt),
      },
    ];

    const columns = DETAIL_COLUMNS;

    return this.reportService.sendReport(res, type, {
      rows: reportData,
      columns,
      title: `كشف راتب: ${salary.employee?.fullName}`,
      filename: `salary_${salary.employee?.employeeCode || id}`,
    });
  }

  @Get()
  @Permissions(PERMS.SALARY_VIEW)
  @RequiresFeature(FEATURES.EMPLOYEES_MODULE) // ✅ حماية عرض القائمة كجزء من الموظفين
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.salariesService.findAll(tenantId);
  }

  @Patch(':id')
  @Permissions(PERMS.SALARY_MANAGE)
  @RequiresFeature(FEATURES.EMPLOYEES_MODULE) // ✅ حماية التعديل كجزء من الموظفين
  @UseGuards(PermissionsGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSalaryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.salariesService.update(id, dto, tenantId);
  }
}
