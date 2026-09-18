import {
  Controller,
  Get,
  Post,
  Patch,
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

@Controller('settlements')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class SettlementsController {
  constructor(
    private readonly settlementsService: SettlementsService,
    private readonly reportService: ReportService,
  ) {}

  @Post('calculate/:employeeId')
  @Permissions(PERMS.SETTLEMENT_VIEW)
  @RequiresFeature(FEATURES.SETTLEMENTS_MODULE)
  @UseGuards(PermissionsGuard)
  calculate(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settlementsService.calculateSettlement(employeeId, tenantId);
  }

  @Post('confirm')
  @Permissions(PERMS.SETTLEMENT_CREATE)
  @RequiresFeature(FEATURES.SETTLEMENTS_MODULE)
  @UseGuards(PermissionsGuard)
  confirm(
    @Body() dto: ConfirmSettlementDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settlementsService.confirmSettlement(dto, tenantId);
  }

  // ✅ Endpoint جديد لتأكيد الصرف
  @Patch(':id/disburse')
  @Permissions(PERMS.SETTLEMENT_CREATE)
  @RequiresFeature(FEATURES.SETTLEMENTS_MODULE)
  @UseGuards(PermissionsGuard)
  disburse(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settlementsService.disburseSettlement(id, tenantId, user);
  }

  @Get('export/:type')
  @Permissions(PERMS.SETTLEMENT_EXPORT)
  @RequiresFeature(FEATURES.REPORTS_EXPORT)
  @UseGuards(PermissionsGuard)
  async exportSettlements(
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.settlementsService.findAll(tenantId);

    const columns = [
      { header: 'الموظف', key: 'employeeName' },
      { header: 'كود الموظف', key: 'employeeCode' },
      { header: 'تاريخ التسوية', key: 'settlementDate' },
      { header: 'عدد الأيام', key: 'unusedLeaveDays' },
      { header: 'إجمالي المبلغ', key: 'totalAmount' },
      { header: 'حالة الصرف', key: 'disbursementStatus' },
      { header: 'صرف بواسطة', key: 'disbursedBy' },
      { header: 'ملاحظات', key: 'notes' },
    ];

    const formattedData = data.map((s) => ({
      employeeName: s.employee?.fullName || '-',
      employeeCode: s.employee?.employeeCode || '-',
      settlementDate: new Date(s.settlementDate).toLocaleDateString('ar-SA'),
      unusedLeaveDays: `${s.unusedLeaveDays} يوم`,
      totalAmount: Number(s.totalAmount).toLocaleString('ar-SA', {
        minimumFractionDigits: 2,
      }),
      disbursementStatus: s.isDisbursed ? 'تم الصرف ✅' : 'غير مصروف',
      disbursedBy: s.isDisbursed
        ? `${s.disbursedBy?.id || '-'} (${new Date(s.disbursedAt!).toLocaleDateString('ar-SA')})`
        : '-',
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
        'تقرير تسويات بدل الاجازة',
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=settlements.pdf',
      );
      return res.send(buffer);
    }
  }

  @Get()
  @Permissions(PERMS.SETTLEMENT_VIEW)
  @RequiresFeature(FEATURES.SETTLEMENTS_MODULE)
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.settlementsService.findAll(tenantId);
  }

  @Get('employee/:employeeId')
  @Permissions(PERMS.SETTLEMENT_VIEW)
  @RequiresFeature(FEATURES.SETTLEMENTS_MODULE)
  @UseGuards(PermissionsGuard)
  findByEmployee(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settlementsService.findByEmployee(employeeId, tenantId);
  }
}
