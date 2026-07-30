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
  BadRequestException,
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
import { ReportService } from '../../common/reports/report.service';
import { PERMS } from 'src/common/constants/permissions';
import { FEATURES } from 'src/common/constants/features'; // ✅ استيراد الثوابت

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
    @Param('type') type: 'excel' | 'pdf',
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
      basicSalary: Number(sal.basicSalary).toLocaleString('ar-SA'),
      housingAllowance: Number(sal.housingAllowance).toLocaleString('ar-SA'),
      transportAllowance: Number(sal.transportAllowance).toLocaleString(
        'ar-SA',
      ),
      otherAllowances: Number(sal.otherAllowances).toLocaleString('ar-SA'),
      totalSalary: Number(sal.totalSalary).toLocaleString('ar-SA'),
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
        'attachment; filename=salaries.xlsx',
      );
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        formattedData,
        columns,
        'تقرير الرواتب',
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=salaries.pdf');
      return res.send(buffer);
    }
  }

  // ✅ مسار التصدير الفردي (يجب أن يكون قبل findOne)
  @Get(':id/export/:type')
  @Permissions(PERMS.SALARY_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportSingleSalary(
    @Param('id') id: string,
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const salary = await this.salariesService.findOne(id, tenantId);

    const reportData: any[] = [
      { label: 'اسم الموظف', value: salary.employee?.fullName || '-' },
      { label: 'كود الموظف', value: salary.employee?.employeeCode || '-' },
      { label: 'المسمى الوظيفي', value: salary.employee?.jobTitle || '-' },
      { label: 'القسم', value: salary.employee?.department || '-' },
      {
        label: 'الأجر الأساسي',
        value: `${Number(salary.basicSalary).toLocaleString('ar-SA')} ر.س`,
      },
      {
        label: 'بدل السكن',
        value: `${Number(salary.housingAllowance).toLocaleString('ar-SA')} ر.س`,
      },
      {
        label: 'بدل النقل',
        value: `${Number(salary.transportAllowance).toLocaleString('ar-SA')} ر.س`,
      },
      {
        label: 'بدلات أخرى',
        value: `${Number(salary.otherAllowances).toLocaleString('ar-SA')} ر.س`,
      },
      {
        label: 'إجمالي الراتب',
        value: `${Number(salary.totalSalary).toLocaleString('ar-SA')} ر.س`,
      },
      {
        label: 'تاريخ آخر تحديث',
        value: new Date(
          salary.updatedAt || salary.createdAt,
        ).toLocaleDateString('ar-SA'),
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
        `attachment; filename=salary_${salary.employee?.employeeCode || id}.xlsx`,
      );
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        reportData,
        columns,
        `كشف راتب: ${salary.employee?.fullName}`,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=salary_${salary.employee?.employeeCode || id}.pdf`,
      );
      return res.send(buffer);
    }

    throw new BadRequestException('نوع التصدير غير مدعوم');
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
