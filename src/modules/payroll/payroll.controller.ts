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
    private readonly reportService: ReportService,
  ) {}

  // ✅ جديد: جلب كل المسيرات
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

    // جلب التفاصيل الكاملة للمسير الأول فقط لغرض التصدير
    const payroll = await this.payrollService.findOneWithDetails(
      payrolls[0].id,
      tenantId,
    );

    if (!payroll) {
      throw new BadRequestException('لم يتم العثور على بيانات المسير للتصدير');
    }

    const columns = [
      { header: '#', key: 'index' },
      { header: 'اسم الموظف', key: 'fullName' },
      { header: 'الراتب الأساسي', key: 'basicSalary' },
      { header: 'البدلات', key: 'allowances' },
      { header: 'خصم قروض', key: 'loanDeduction' },
      { header: 'خصم سلف', key: 'advanceDeduction' },
      { header: 'الإجمالي', key: 'gross' },
      { header: 'الصافي', key: 'netSalary' },
    ];

    const data = payroll.items.map((item, i) => ({
      index: i + 1,
      fullName: item.employee.fullName,
      basicSalary: Number(item.basicSalary).toLocaleString('en-US'),
      allowances: Number(item.allowances).toLocaleString('en-US'),
      loanDeduction: Number(item.loanDeduction).toLocaleString('en-US'),
      advanceDeduction: Number(item.advanceDeduction).toLocaleString('en-US'),
      gross: (
        Number(item.basicSalary) + Number(item.allowances)
      ).toLocaleString('en-US'),
      netSalary: Number(item.netSalary).toLocaleString('en-US'),
    }));

    data.push({
      index: 0,
      fullName: 'الإجمالي',
      basicSalary: '',
      allowances: '',
      loanDeduction: '',
      advanceDeduction: '',
      gross: Number(payroll.totalNetSalary).toLocaleString('en-US'),
      netSalary: Number(payroll.totalNetSalary).toLocaleString('en-US'),
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
