// src/modules/bonuses/bonuses.controller.ts
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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import type { Response } from 'express';
import { BonusesService } from './bonuses.service';
import { CreateBonusDto } from './dto/create-bonus.dto';
import { UpdateBonusDto } from './dto/update-bonus.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard'; // ✅ استيراد الحارس
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator'; // ✅ استيراد ديكوراتور الميزة
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { CurrentCurrency } from '../../common/decorators/current-currency.decorator';
import {
  DETAIL_COLUMNS,
  ReportService,
  type ReportRow,
} from '../../common/reports/report.service';
import { PERMS } from '../../common/constants/permissions';
import { FEATURES } from '../../common/constants/features'; // ✅ استيراد الثوابت
import { BonusStatus } from './entities/bonus.entity';
import {
  CurrentUser,
  type CurrentUserData,
} from '../../common/decorators/current-user.decorator';
import {
  formatAmount,
  formatDate,
  formatMoney,
} from '../../common/utils/format.util';

@ApiTags(apiTag('BONUSES'))
@Controller('bonuses')
@UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ تفعيل حراس الاشتراك والمصادقة
export class BonusesController {
  constructor(
    private readonly bonusesService: BonusesService,
    private readonly reportService: ReportService,
  ) {}

  /** إضافة مكافأة لموظف */
  @Post()
  @Permissions(PERMS.BONUS_CREATE)
  @RequiresFeature(FEATURES.BONUSES_MODULE) // ✅ التحقق من توفر الموديول (يفضل إضافة BONUSES_MODULE للثوابت)
  @UseGuards(PermissionsGuard)
  create(@Body() dto: CreateBonusDto, @CurrentTenantId() tenantId: string) {
    return this.bonusesService.create(dto, tenantId);
  }

  /** صرف مكافأة معتمدة مباشرة خارج المسير (تُخصم من صافي المسير لمنع الصرف مرتين) */
  @Patch(':id/disburse')
  @Permissions(PERMS.BONUS_UPDATE)
  @RequiresFeature(FEATURES.BONUSES_MODULE)
  @UseGuards(PermissionsGuard)
  async disburse(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.bonusesService.disburseBonus(id, user.tenantId, user.id);
  }

  // ✅ مسار التصدير الجماعي للمكافآت
  /** تصدير المكافآت (excel أو pdf) */
  @Get('export/:type')
  @Permissions(PERMS.BONUS_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportBonuses(
    @Param('type') type: string,
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.bonusesService.findAll(tenantId);

    const columns = [
      { header: 'اسم الموظف', key: 'employeeName' },
      { header: 'كود الموظف', key: 'employeeCode' },
      { header: 'المبلغ', key: 'amount' },
      { header: 'تاريخ الصرف', key: 'payoutDate' },
      { header: 'الحالة', key: 'status' },
      { header: 'ملاحظات', key: 'notes' },
      { header: 'تاريخ التسجيل', key: 'createdAt' },
    ];

    const formattedData = data.map((b) => ({
      employeeName: b.employee?.fullName || '-',
      employeeCode: b.employee?.employeeCode || '-',
      amount: formatAmount(b.amount),
      payoutDate: formatDate(b.payoutDate),
      status: this.getStatusLabel(b.status),
      notes: b.notes || '-',
      createdAt: formatDate(b.createdAt),
    }));

    return this.reportService.sendReport(res, type, {
      rows: formattedData,
      columns,
      title: 'تقرير المكافآت',
      filename: 'bonuses',
    });
  }

  // ✅ مسار التصدير الفردي للمكافأة
  /** تصدير مكافأة واحدة (excel أو pdf) */
  @Get(':id/export/:type')
  @Permissions(PERMS.BONUS_VIEW)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  @UseGuards(PermissionsGuard)
  async exportSingleBonus(
    @Param('id') id: string,
    @Param('type') type: string,
    @CurrentTenantId() tenantId: string,
    @CurrentCurrency() currency: string,
    @Res() res: Response,
  ) {
    const bonus = await this.bonusesService.findOne(id, tenantId);

    const reportData: ReportRow[] = [
      { label: 'اسم الموظف', value: bonus.employee?.fullName || '-' },
      { label: 'كود الموظف', value: bonus.employee?.employeeCode || '-' },
      { label: 'المسمى الوظيفي', value: bonus.employee?.jobTitle || '-' },
      {
        label: 'المبلغ',
        value: formatMoney(bonus.amount, currency),
      },
      {
        label: 'تاريخ الصرف',
        value: formatDate(bonus.payoutDate),
      },
      { label: 'الحالة', value: this.getStatusLabel(bonus.status) },
      { label: 'ملاحظات', value: bonus.notes || '-' },
      {
        label: 'تاريخ التسجيل',
        value: formatDate(bonus.createdAt),
      },
    ];

    const columns = DETAIL_COLUMNS;

    return this.reportService.sendReport(res, type, {
      rows: reportData,
      columns,
      title: `مكافأة: ${bonus.employee?.fullName}`,
      filename: `bonus_${bonus.employee?.employeeCode || id}`,
    });
  }

  /** قائمة المكافآت */
  @Get()
  @Permissions(PERMS.BONUS_VIEW)
  @RequiresFeature(FEATURES.BONUSES_MODULE) // ✅ حماية عرض القائمة
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.bonusesService.findAll(tenantId);
  }

  /** مكافأة واحدة */
  @Get(':id')
  @Permissions(PERMS.BONUS_VIEW)
  @RequiresFeature(FEATURES.BONUSES_MODULE) // ✅ حماية عرض التفاصيل
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.bonusesService.findOne(id, tenantId);
  }

  /** تعديل مكافأة */
  @Patch(':id')
  @Permissions(PERMS.BONUS_UPDATE)
  @RequiresFeature(FEATURES.BONUSES_MODULE) // ✅ حماية التعديل
  @UseGuards(PermissionsGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBonusDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.bonusesService.update(id, dto, tenantId);
  }

  // ✅ Endpoint جديد لتغيير حالة المكافأة
  /** تغيير حالة مكافأة (اعتماد أو رفض) */
  @Patch(':id/status')
  @Permissions(PERMS.BONUS_UPDATE)
  @RequiresFeature(FEATURES.BONUSES_MODULE) // ✅ حماية تغيير الحالة
  @UseGuards(PermissionsGuard)
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: BonusStatus,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.bonusesService.updateStatus(id, status, tenantId);
  }

  /** حذف مكافأة */
  @Delete(':id')
  @Permissions(PERMS.BONUS_DELETE)
  @RequiresFeature(FEATURES.BONUSES_MODULE) // ✅ حماية الحذف
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.bonusesService.remove(id, tenantId);
  }

  // ✅ دالة مساعدة لترجمة الحالة للعربية في التقارير
  private getStatusLabel(status: BonusStatus): string {
    switch (status) {
      case BonusStatus.PENDING:
        return 'معلقة';
      case BonusStatus.APPROVED:
        return 'موافق عليها';
      case BonusStatus.REJECTED:
        return 'مرفوضة';
      case BonusStatus.PAID:
        return 'تم الصرف';
      default:
        return status;
    }
  }
}
