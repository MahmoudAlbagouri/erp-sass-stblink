// src/modules/payroll/payroll.controller.ts
import {
  Controller,
  Get,
  Post,
  Param,
  Res,
  UseGuards,
  BadRequestException,
  Query,
} from '@nestjs/common';
import type { Response } from 'express';
import { PayrollService } from './payroll.service';
import { SalariesService } from '../salaries/salaries.service'; // ✅ استيراد خدمة الرواتب
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { ReportService } from '../../common/reports/report.service';
import { PERMS } from 'src/common/constants/permissions';

@Controller('payroll')
@UseGuards(JwtAuthGuard)
export class PayrollController {
  constructor(
    private readonly payrollService: PayrollService,
    private readonly salariesService: SalariesService, // ✅ إضافة الخدمة
    private readonly reportService: ReportService,
  ) {}

  @Get()
  @Permissions(PERMS.PAYROLL_VIEW)
  @UseGuards(PermissionsGuard)
  getAllPayrolls(
    @CurrentTenantId() tenantId: string,
    @Query('year') year?: number,
    @Query('month') month?: number,
  ) {
    return this.payrollService.findAllPayrolls(
      tenantId,
      year ? Number(year) : undefined,
      month ? Number(month) : undefined,
    );
  }

  @Post('generate/:month/:year')
  @Permissions(PERMS.PAYROLL_GENERATE)
  @UseGuards(PermissionsGuard)
  generate(
    @Param('month') month: number,
    @Param('year') year: number,
    @CurrentTenantId() tenantId: string,
  ) {
    if (!tenantId) throw new BadRequestException('Tenant ID is missing');
    return this.payrollService.generateMonthlyPayroll(
      Number(month),
      Number(year),
      tenantId,
    );
  }

  @Get(':id')
  @Permissions(PERMS.PAYROLL_VIEW)
  @UseGuards(PermissionsGuard)
  getDetails(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.payrollService.findOneWithDetails(id, tenantId);
  }

  @Get('export/:type/:month/:year')
  @Permissions(PERMS.PAYROLL_EXPORT)
  @UseGuards(PermissionsGuard)
  async exportPayroll(
    @Param('type') type: 'excel' | 'pdf',
    @Param('month') month: number,
    @Param('year') year: number,
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const payrolls = await this.payrollService.findByMonth(
      Number(month),
      Number(year),
      tenantId,
    );
    if (!payrolls.length)
      throw new BadRequestException('لا يوجد مسير لهذا الشهر');

    const payroll = await this.payrollService.findOneWithDetails(
      payrolls[0].id,
      tenantId,
    );

    if (!payroll || !payroll.items?.length) {
      throw new BadRequestException('لم يتم العثور على بيانات للتصدير');
    }

    // ✅ 1. جلب هياكل الرواتب لجميع الموظفين في هذا المسير دفعة واحدة
    const employeeIds = payroll.items.map((item) => item.employeeId);
    const salaries = await this.salariesService.findByEmployeeIds(employeeIds);

    // إنشاء خريطة للبحث السريع عن الراتب باستخدام employeeId كمفتاح
    const salaryMap = new Map();
    salaries.forEach((s) => salaryMap.set(s.employeeId, s));

    // ✅ 2. تعريف الأعمدة بالترتيب الجديد
    const columns = [
      { header: 'الرقم الوظيفي', key: 'employeeCode' },
      { header: 'رقم الهوية', key: 'nationalId' },
      { header: 'اسم الموظف', key: 'fullName' },
      { header: 'الراتب الأساسي', key: 'basicSalary' },
      { header: 'بدل السكن', key: 'housingAllowance' },
      { header: 'بدلات أخرى', key: 'otherAllowances' },
      { header: 'إجمالي الراتب', key: 'totalGross' },
      { header: 'الخصومات', key: 'deductions' },
      { header: 'الصافي', key: 'netSalary' },
    ];

    // ✅ 3. تجهيز البيانات مع فصل البدلات
    const data = payroll.items.map((item) => {
      const salary = salaryMap.get(item.employeeId);

      // استخدام قيم الراتب الأصلي إذا وجدت، وإلا الاعتماد على قيم المسير المجمعة
      const basic = Number(salary?.basicSalary ?? item.basicSalary) || 0;
      const housing = Number(salary?.housingAllowance ?? 0) || 0;
      // البدلات الأخرى تشمل النقل + أي بدلات إضافية
      const other =
        (Number(salary?.transportAllowance ?? 0) || 0) +
        (Number(salary?.otherAllowances ?? 0) || 0);

      const loan = Number(item.loanDeduction) || 0;
      const advance = Number(item.advanceDeduction) || 0;
      const unpaid = Number(item.unpaidLeaveDeduction) || 0;
      const otherDed = Number(item.otherDeductions) || 0;

      const totalGross = basic + housing + other;
      const totalDeductions = loan + advance + unpaid + otherDed;
      const net = Number(item.netSalary) || 0;

      return {
        employeeCode: item.employee?.employeeCode || '-',
        nationalId: item.employee?.nationalId || '-',
        fullName: item.employee?.fullName || '-',
        basicSalary: basic.toLocaleString('en-US'),
        housingAllowance: housing.toLocaleString('en-US'),
        otherAllowances: other.toLocaleString('en-US'),
        totalGross: totalGross.toLocaleString('en-US'),
        deductions: totalDeductions.toLocaleString('en-US'),
        netSalary: net.toLocaleString('en-US'),
      };
    });

    // ✅ 4. حساب الإجماليات النهائية
    const totals = payroll.items.reduce(
      (acc, item) => {
        const salary = salaryMap.get(item.employeeId);
        const b = Number(salary?.basicSalary ?? item.basicSalary) || 0;
        const h = Number(salary?.housingAllowance ?? 0) || 0;
        const o =
          (Number(salary?.transportAllowance ?? 0) || 0) +
          (Number(salary?.otherAllowances ?? 0) || 0);

        acc.basic += b;
        acc.housing += h;
        acc.other += o;
        acc.gross += b + h + o;
        acc.deductions +=
          (Number(item.loanDeduction) || 0) +
          (Number(item.advanceDeduction) || 0) +
          (Number(item.unpaidLeaveDeduction) || 0) +
          (Number(item.otherDeductions) || 0);
        acc.net += Number(item.netSalary) || 0;
        return acc;
      },
      { basic: 0, housing: 0, other: 0, gross: 0, deductions: 0, net: 0 },
    );

    data.push({
      employeeCode: '',
      nationalId: '',
      fullName: 'الإجمالي',
      basicSalary: totals.basic.toLocaleString('en-US'),
      housingAllowance: totals.housing.toLocaleString('en-US'),
      otherAllowances: totals.other.toLocaleString('en-US'),
      totalGross: totals.gross.toLocaleString('en-US'),
      deductions: totals.deductions.toLocaleString('en-US'),
      netSalary: totals.net.toLocaleString('en-US'),
    });

    // ✅ 5. التصدير
    if (type === 'excel') {
      const buffer = await this.reportService.generateExcel(data, columns);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=payroll_${year}_${month}.xlsx`,
      );
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        data,
        columns,
        `كشف رواتب شهر ${month}/${year}`,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=payroll_${year}_${month}.pdf`,
      );
      return res.send(buffer);
    }
  }
}
