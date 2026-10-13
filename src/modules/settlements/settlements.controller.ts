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
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
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
import { PERMS } from '../../common/constants/permissions';
import { FEATURES } from '../../common/constants/features';
import { DISPLAY_LOCALE, formatDate } from '../../common/utils/format.util';

@ApiTags(apiTag('SETTLEMENTS'))
@Controller('settlements')
@UseGuards(JwtAuthGuard, SubscriptionGuard)
export class SettlementsController {
  constructor(
    private readonly settlementsService: SettlementsService,
    private readonly reportService: ReportService,
  ) {}

  /** حساب مستحقات بدل الإجازة لموظف (معاينة بلا حفظ) */
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

  /** تأكيد التسوية وحفظها */
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
  /** تأكيد صرف تسوية مباشرة خارج المسير */
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

  /** تصدير التسويات (excel أو pdf) */
  @Get('export/:type')
  @Permissions(PERMS.SETTLEMENT_EXPORT)
  @RequiresFeature(FEATURES.REPORTS_EXPORT)
  @UseGuards(PermissionsGuard)
  async exportSettlements(
    @Param('type') type: string,
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
      settlementDate: formatDate(s.settlementDate),
      unusedLeaveDays: `${s.unusedLeaveDays} يوم`,
      totalAmount: Number(s.totalAmount).toLocaleString(DISPLAY_LOCALE, {
        minimumFractionDigits: 2,
      }),
      disbursementStatus: s.isDisbursed ? 'تم الصرف ✅' : 'غير مصروف',
      disbursedBy: s.isDisbursed
        ? `${s.disbursedBy?.id || '-'} (${formatDate(s.disbursedAt!)})`
        : '-',
      notes: s.notes || '-',
    }));

    return this.reportService.sendReport(res, type, {
      rows: formattedData,
      columns,
      title: 'تقرير تسويات بدل الاجازة',
      filename: 'settlements',
    });
  }

  /** قائمة التسويات */
  @Get()
  @Permissions(PERMS.SETTLEMENT_VIEW)
  @RequiresFeature(FEATURES.SETTLEMENTS_MODULE)
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.settlementsService.findAll(tenantId);
  }

  /** تسويات موظف واحد */
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
