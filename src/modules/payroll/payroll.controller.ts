import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Res,
  UseGuards,
  BadRequestException,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { PayrollService } from './payroll.service';
import { SalariesService } from '../salaries/salaries.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import {
  CurrentUser,
  type CurrentUserData,
} from '../../common/decorators/current-user.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { ReportService } from '../../common/reports/report.service';
import { PERMS } from 'src/common/constants/permissions';
import { FEATURES } from 'src/common/constants/features';

@Controller('payroll')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class PayrollController {
  constructor(
    private readonly payrollService: PayrollService,
    private readonly salariesService: SalariesService,
    private readonly reportService: ReportService,
  ) {}

  @Get()
  @Permissions(PERMS.PAYROLL_VIEW)
  @RequiresFeature(FEATURES.PAYROLL_MODULE)
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
  @RequiresFeature(FEATURES.PAYROLL_MODULE)
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

  // ✅ Endpoint جديد لتأكيد صرف المسير
  @Patch(':id/disburse')
  @Permissions(PERMS.PAYROLL_GENERATE)
  @RequiresFeature(FEATURES.PAYROLL_MODULE)
  @UseGuards(PermissionsGuard)
  disbursePayroll(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
  ) {
    if (!user.id) throw new BadRequestException('User ID is missing');
    return this.payrollService.disbursePayroll(id, tenantId, user.id);
  }

  @Get(':id')
  @Permissions(PERMS.PAYROLL_VIEW)
  @RequiresFeature(FEATURES.PAYROLL_MODULE)
  @UseGuards(PermissionsGuard)
  getDetails(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.payrollService.findOneWithDetails(id, tenantId);
  }

  @Get('export/:type/:month/:year')
  @Permissions(PERMS.PAYROLL_EXPORT)
  @RequiresFeature(FEATURES.REPORTS_EXPORT)
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

    const employeeIds = payroll.items.map((item) => item.employeeId);
    const salaries = await this.salariesService.findByEmployeeIds(employeeIds);

    const salaryMap = new Map();
    salaries.forEach((s) => salaryMap.set(s.employeeId, s));

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

    const data = payroll.items.map((item) => {
      const salary = salaryMap.get(item.employeeId);

      const basic = Number(salary?.basicSalary ?? item.basicSalary) || 0;
      const housing = Number(salary?.housingAllowance ?? 0) || 0;
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
