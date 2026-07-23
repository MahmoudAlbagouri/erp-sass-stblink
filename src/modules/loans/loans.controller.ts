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
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { LoanStatus } from './entities/loan.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import {
  CurrentUser,
  type CurrentUserData,
} from '../../common/decorators/current-user.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { ReportService } from '../../common/reports/report.service';
import { PERMS } from 'src/common/constants/permissions';

@Controller('loans')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LoansController {
  constructor(
    private readonly loansService: LoansService,
    private readonly reportService: ReportService,
  ) {}

  @Post('my-loans')
  @Permissions(PERMS.LOAN_REQUEST_SELF)
  createMyLoan(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateLoanDto,
  ) {
    if (!user.employeeId)
      throw new NotFoundException(
        'حسابك غير مرتبط بملف موظف، لا يمكنك طلب قرض',
      );
    return this.loansService.create(dto, user.employeeId, tenantId);
  }

  // ✅ مسار التصدير الجماعي للقروض
  @Get('export/:type')
  @Permissions(PERMS.LOAN_VIEW)
  @UseGuards(PermissionsGuard)
  async exportLoans(
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.loansService.findAll(tenantId);

    const columns = [
      { header: 'اسم الموظف', key: 'employeeName' },
      { header: 'إجمالي القرض', key: 'totalAmount' },
      { header: 'القسط الشهري', key: 'monthlyInstallment' },
      { header: 'عدد الأقساط الكلي', key: 'installmentsCount' },
      { header: 'الأقساط المسددة', key: 'paidInstallments' }, // ✅ جديد
      { header: 'الأقساط المتبقية', key: 'remainingInstallments' }, // ✅ جديد
      { header: 'الحالة', key: 'status' },
      { header: 'تاريخ البداية', key: 'startDate' },
      { header: 'السبب', key: 'reason' },
    ];

    const formattedData = data.map((l) => ({
      employeeName: l.employee?.fullName || '-',
      totalAmount: Number(l.totalAmount).toLocaleString('ar-SA'),
      monthlyInstallment: Number(l.monthlyInstallment).toLocaleString('ar-SA'),
      installmentsCount: l.installmentsCount,
      paidInstallments: l.paidInstallments || 0, // ✅ عرض القيمة الفعلية
      remainingInstallments: l.installmentsCount - (l.paidInstallments || 0), // ✅ حساب المتبقي
      status:
        String(l.status) === 'pending'
          ? 'معلق'
          : String(l.status) === 'approved'
            ? 'معتمد'
            : String(l.status) === 'rejected'
              ? 'مرفوض'
              : 'مكتمل',
      startDate: new Date(l.startDate).toLocaleDateString('ar-SA'),
      reason: l.reason || '-',
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
      res.setHeader('Content-Disposition', 'attachment; filename=loans.xlsx');
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        formattedData,
        columns,
        'تقرير القروض',
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=loans.pdf');
      return res.send(buffer);
    }
  }

  // ✅ مسار التصدير الفردي للقرض
  @Get(':id/export/:type')
  @Permissions(PERMS.LOAN_VIEW)
  @UseGuards(PermissionsGuard)
  async exportSingleLoan(
    @Param('id') id: string,
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const loan = await this.loansService.findOne(id, tenantId);
    if (!loan) throw new BadRequestException('القرض غير موجود');

    const paid = loan.paidInstallments || 0;
    const remaining = loan.installmentsCount - paid;

    const reportData: any[] = [
      { label: 'اسم الموظف', value: loan.employee?.fullName || '-' },
      { label: 'كود الموظف', value: loan.employee?.employeeCode || '-' },
      { label: 'المسمى الوظيفي', value: loan.employee?.jobTitle || '-' },
      {
        label: 'إجمالي القرض',
        value: `${Number(loan.totalAmount).toLocaleString('ar-SA')} ر.س`,
      },
      {
        label: 'القسط الشهري',
        value: `${Number(loan.monthlyInstallment).toLocaleString('ar-SA')} ر.س`,
      },
      { label: 'عدد الأقساط الكلي', value: loan.installmentsCount },
      { label: 'الأقساط المسددة', value: paid }, // ✅ جديد
      { label: 'الأقساط المتبقية', value: remaining }, // ✅ جديد
      {
        label: 'نسبة السداد',
        value: `${Math.round((paid / loan.installmentsCount) * 100)}%`,
      }, // ✅ جديد
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
        value: new Date(loan.startDate).toLocaleDateString('ar-SA'),
      },
      { label: 'السبب', value: loan.reason || '-' },
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
        `attachment; filename=loan_${loan.employee?.employeeCode || id}.xlsx`,
      );
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        reportData,
        columns,
        `قرض: ${loan.employee?.fullName}`,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=loan_${loan.employee?.employeeCode || id}.pdf`,
      );
      return res.send(buffer);
    }

    throw new BadRequestException('نوع التصدير غير مدعوم');
  }

  @Get()
  @Permissions(PERMS.LOAN_VIEW)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.loansService.findAll(tenantId);
  }

  @Patch(':id/status')
  @Permissions(PERMS.LOAN_APPROVE)
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: LoanStatus,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.loansService.updateStatus(id, status, tenantId);
  }
}
