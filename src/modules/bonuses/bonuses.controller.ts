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
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { BonusesService } from './bonuses.service';
import { CreateBonusDto } from './dto/create-bonus.dto';
import { UpdateBonusDto } from './dto/update-bonus.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { ReportService } from '../../common/reports/report.service';
import { PERMS } from '../../common/constants/permissions';
import { BonusStatus } from './entities/bonus.entity';

@Controller('bonuses')
@UseGuards(JwtAuthGuard)
export class BonusesController {
  constructor(
    private readonly bonusesService: BonusesService,
    private readonly reportService: ReportService,
  ) {}

  @Post()
  @Permissions(PERMS.BONUS_CREATE)
  @UseGuards(PermissionsGuard)
  create(@Body() dto: CreateBonusDto, @CurrentTenantId() tenantId: string) {
    return this.bonusesService.create(dto, tenantId);
  }

  // ✅ مسار التصدير الجماعي للمكافآت
  @Get('export/:type')
  @Permissions(PERMS.BONUS_VIEW)
  @UseGuards(PermissionsGuard)
  async exportBonuses(
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.bonusesService.findAll(tenantId);

    const columns = [
      { header: 'اسم الموظف', key: 'employeeName' },
      { header: 'كود الموظف', key: 'employeeCode' },
      { header: 'المبلغ', key: 'amount' },
      { header: 'تاريخ الصرف', key: 'payoutDate' },
      { header: 'الحالة', key: 'status' }, // ✅ إضافة عمود الحالة
      { header: 'ملاحظات', key: 'notes' },
      { header: 'تاريخ التسجيل', key: 'createdAt' },
    ];

    const formattedData = data.map((b) => ({
      employeeName: b.employee?.fullName || '-',
      employeeCode: b.employee?.employeeCode || '-',
      amount: Number(b.amount).toLocaleString('ar-SA'),
      payoutDate: new Date(b.payoutDate).toLocaleDateString('ar-SA'),
      status: this.getStatusLabel(b.status), // ✅ ترجمة الحالة
      notes: b.notes || '-',
      createdAt: new Date(b.createdAt).toLocaleDateString('ar-SA'),
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
      res.setHeader('Content-Disposition', 'attachment; filename=bonuses.xlsx');
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        formattedData,
        columns,
        'تقرير المكافآت',
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=bonuses.pdf');
      return res.send(buffer);
    }
  }

  // ✅ مسار التصدير الفردي للمكافأة
  @Get(':id/export/:type')
  @Permissions(PERMS.BONUS_VIEW)
  @UseGuards(PermissionsGuard)
  async exportSingleBonus(
    @Param('id') id: string,
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const bonus = await this.bonusesService.findOne(id, tenantId);
    if (!bonus) throw new BadRequestException('المكافأة غير موجودة');

    const reportData: any[] = [
      { label: 'اسم الموظف', value: bonus.employee?.fullName || '-' },
      { label: 'كود الموظف', value: bonus.employee?.employeeCode || '-' },
      { label: 'المسمى الوظيفي', value: bonus.employee?.jobTitle || '-' },
      {
        label: 'المبلغ',
        value: `${Number(bonus.amount).toLocaleString('ar-SA')} ر.س`,
      },
      {
        label: 'تاريخ الصرف',
        value: new Date(bonus.payoutDate).toLocaleDateString('ar-SA'),
      },
      { label: 'الحالة', value: this.getStatusLabel(bonus.status) }, // ✅ إضافة الحالة
      { label: 'ملاحظات', value: bonus.notes || '-' },
      {
        label: 'تاريخ التسجيل',
        value: new Date(bonus.createdAt).toLocaleDateString('ar-SA'),
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
        `attachment; filename=bonus_${bonus.employee?.employeeCode || id}.xlsx`,
      );
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        reportData,
        columns,
        `مكافأة: ${bonus.employee?.fullName}`,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=bonus_${bonus.employee?.employeeCode || id}.pdf`,
      );
      return res.send(buffer);
    }

    throw new BadRequestException('نوع التصدير غير مدعوم');
  }

  @Get()
  @Permissions(PERMS.BONUS_VIEW)
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.bonusesService.findAll(tenantId);
  }

  @Get(':id')
  @Permissions(PERMS.BONUS_VIEW)
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.bonusesService.findOne(id, tenantId);
  }

  @Patch(':id')
  @Permissions(PERMS.BONUS_UPDATE)
  @UseGuards(PermissionsGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBonusDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.bonusesService.update(id, dto, tenantId);
  }

  // ✅ Endpoint جديد لتغيير حالة المكافأة
  @Patch(':id/status')
  @Permissions(PERMS.BONUS_UPDATE) // أو صلاحية خاصة مثل BONUS_APPROVE
  @UseGuards(PermissionsGuard)
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: BonusStatus,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.bonusesService.updateStatus(id, status, tenantId);
  }

  @Delete(':id')
  @Permissions(PERMS.BONUS_DELETE)
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
