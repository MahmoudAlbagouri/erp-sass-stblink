import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { SettlementsService } from './settlements.service';
import { ConfirmSettlementDto } from './dto/confirm-settlement.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { ReportService } from '../../common/reports/report.service';
import { PERMS } from 'src/common/constants/permissions';

@Controller('settlements')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SettlementsController {
  constructor(
    private readonly settlementsService: SettlementsService,
    private readonly reportService: ReportService, // ✅ تم الحقن هنا
  ) {}

  /**
   * POST /settlements/calculate/:employeeId
   * يعرض معاينة المستحقات (رصيد متاح + مبلغ افتراضي لو كانت التسوية كاملة)
   * قبل التأكيد. لا يُحفظ شيء هنا.
   */
  @Post('calculate/:employeeId')
  @Permissions(PERMS.SETTLEMENT_VIEW)
  calculate(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settlementsService.calculateSettlement(employeeId, tenantId);
  }

  /**
   * POST /settlements/confirm
   * يؤكد التسوية (كاملة أو جزئية حسب dto.settlementType) ويحفظها،
   * ويُحدّث رصيد الإجازات وفق نوع التسوية.
   */
  @Post('confirm')
  @Permissions(PERMS.SETTLEMENT_CREATE)
  confirm(
    @Body() dto: ConfirmSettlementDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settlementsService.confirmSettlement(dto, tenantId);
  }

  /**
   * GET /settlements/export/:type
   * ✅ مسار جديد لتصدير أرشيف التسويات بصيغة Excel أو PDF
   */
  @Get('export/:type')
  @Permissions(PERMS.SETTLEMENT_EXPORT) // تأكد من وجود هذا الصلاحية في ثوابتك
  @UseGuards(PermissionsGuard)
  async exportSettlements(
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.settlementsService.findAll(tenantId);

    // تعريف الأعمدة المطلوبة للتقرير
    const columns = [
      { header: 'الموظف', key: 'employeeName' },
      { header: 'كود الموظف', key: 'employeeCode' },
      { header: 'تاريخ التسوية', key: 'settlementDate' },
      { header: 'عدد الأيام', key: 'unusedLeaveDays' },
      { header: 'أجر اليوم', key: 'dailyRate' },
      { header: 'إجمالي المبلغ', key: 'totalAmount' },
      { header: 'ملاحظات', key: 'notes' },
    ];

    // تنسيق البيانات لتتوافق مع مفاتيح الأعمدة
    const formattedData = data.map((s) => ({
      employeeName: s.employee?.fullName || '-',
      employeeCode: s.employee?.employeeCode || '-',
      settlementDate: new Date(s.settlementDate).toLocaleDateString('ar-SA'),
      unusedLeaveDays: `${s.unusedLeaveDays} يوم`,
      dailyRate: Number(s.dailyRate).toLocaleString('ar-SA', {
        minimumFractionDigits: 2,
      }),
      totalAmount: Number(s.totalAmount).toLocaleString('ar-SA', {
        minimumFractionDigits: 2,
      }),
      notes: s.notes || '-',
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
        'attachment; filename=settlements.xlsx',
      );
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        formattedData,
        columns,
        'تقرير تسويات نهاية الخدمة',
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=settlements.pdf',
      );
      return res.send(buffer);
    }
  }

  /**
   * GET /settlements
   * جلب كل التسويات المؤرشفة
   */
  @Get()
  @Permissions(PERMS.SETTLEMENT_VIEW)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.settlementsService.findAll(tenantId);
  }

  /**
   * GET /settlements/employee/:employeeId
   * جلب تسوية موظف محدد
   */
  @Get('employee/:employeeId')
  @Permissions(PERMS.SETTLEMENT_VIEW)
  findByEmployee(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settlementsService.findByEmployee(employeeId, tenantId);
  }
}
