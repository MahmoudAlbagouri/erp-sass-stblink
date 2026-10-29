// src/modules/contracts/contracts.controller.ts
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
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard'; // ✅ استيراد الحارس
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator'; // ✅ استيراد ديكوراتور الميزة
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import {
  DETAIL_COLUMNS,
  ReportService,
  type ReportRow,
} from '../../common/reports/report.service';
import { PERMS } from '../../common/constants/permissions';
import { formatDate } from '../../common/utils/format.util';
import { FEATURES } from '../../common/constants/features'; // ✅ استيراد الثوابت

@ApiTags(apiTag('CONTRACTS'))
@Controller('contracts')
@UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard) // ✅ تفعيل حراس الاشتراك والصلاحيات
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly reportService: ReportService,
  ) {}

  /** إضافة عقد لموظف (عقد واحد لكل موظف) */
  @Post()
  @Permissions(PERMS.CONTRACT_CREATE)
  @RequiresFeature(FEATURES.CONTRACTS_MODULE) // ✅ التحقق من توفر الموديول في الخطة
  create(@Body() dto: CreateContractDto, @CurrentTenantId() tenantId: string) {
    return this.contractsService.create(dto, tenantId);
  }

  // ✅ مسار التصدير الجماعي للعقود
  /** تصدير العقود (excel أو pdf) */
  @Get('export/:type')
  @Permissions(PERMS.CONTRACT_EXPORT)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  async exportContracts(
    @Param('type') type: string,
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.contractsService.findAll(tenantId);
    const columns = [
      { header: 'اسم الموظف', key: 'employeeFullName' },
      { header: 'كود الموظف', key: 'employeeCode' },
      { header: 'نوع العقد', key: 'contractType' },
      { header: 'تاريخ البدء', key: 'startDate' },
      { header: 'تاريخ الانتهاء', key: 'endDate' },
      { header: 'مدة العقد', key: 'durationYears' },
      { header: 'الإجازة السنوية', key: 'annualLeaveDays' },
      { header: 'التأمين الطبي', key: 'medicalInsurance' },
      { header: 'التذكرة', key: 'ticketType' },
      { header: 'فترة التجربة', key: 'probationPeriod' },
    ];

    const formattedData = data.map((contract) => ({
      employeeFullName: contract.employee?.fullName || '-',
      employeeCode: contract.employee?.employeeCode || '-',
      contractType: contract.contractType,
      startDate: formatDate(contract.startDate),
      endDate: contract.endDate ? formatDate(contract.endDate) : 'غير محدد',
      durationYears: contract.contractDurationYears
        ? `${contract.contractDurationYears} سنوات`
        : '-',
      annualLeaveDays: `${contract.annualLeaveDays} يوم`,
      medicalInsurance: contract.medicalInsurance || '-',
      ticketType: contract.ticketType || '-',
      probationPeriod: contract.probationPeriod || '-',
    }));

    return this.reportService.sendReport(res, type, {
      rows: formattedData,
      columns,
      title: 'تقرير العقود',
      filename: 'contracts',
    });
  }

  // ✅ مسار التصدير الفردي لعقد واحد (يجب أن يكون قبل findOne)
  /** تصدير عقد واحد (excel أو pdf) */
  @Get(':id/export/:type')
  @Permissions(PERMS.CONTRACT_EXPORT)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  async exportSingleContract(
    @Param('id') id: string,
    @Param('type') type: string,
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const contract = await this.contractsService.findOne(id, tenantId);

    const reportData: ReportRow[] = [
      { label: 'اسم الموظف', value: contract.employee?.fullName || '-' },
      { label: 'كود الموظف', value: contract.employee?.employeeCode || '-' },
      { label: 'المسمى الوظيفي', value: contract.employee?.jobTitle || '-' },
      { label: 'القسم', value: contract.employee?.department?.name || '-' },
      { label: 'نوع العقد', value: contract.contractType },
      {
        label: 'تاريخ البداية',
        value: formatDate(contract.startDate),
      },
      {
        label: 'تاريخ النهاية',
        value: contract.endDate ? formatDate(contract.endDate) : 'غير محدد',
      },
      {
        label: 'مدة العقد',
        value: contract.contractDurationYears
          ? `${contract.contractDurationYears} سنوات`
          : '-',
      },
      {
        label: 'أيام الإجازة السنوية',
        value: `${contract.annualLeaveDays} يوم`,
      },
      { label: 'التأمين الطبي', value: contract.medicalInsurance || '-' },
      { label: 'التذكرة', value: contract.ticketType || '-' },
      { label: 'فترة التجربة', value: contract.probationPeriod || '-' },
      { label: 'الجنسية', value: contract.nationality || '-' },
      {
        label: 'تاريخ الإنشاء',
        value: formatDate(contract.createdAt),
      },
    ];

    if (contract.notes) {
      reportData.push({ label: 'ملاحظات العقد', value: contract.notes });
    }

    // أسماء المرفقات فقط: روابطها مؤقتة فلا معنى لطباعتها
    if (contract.attachments?.length) {
      reportData.push({ label: '--- المرفقات ---', value: '' });
      contract.attachments.forEach((file, i) => {
        reportData.push({ label: `مرفق #${i + 1}`, value: file.originalName });
      });
    }

    const columns = DETAIL_COLUMNS;

    return this.reportService.sendReport(res, type, {
      rows: reportData,
      columns,
      title: `عقد الموظف: ${contract.employee?.fullName}`,
      filename: `contract_${contract.employee?.employeeCode || id}`,
    });
  }

  /** قائمة العقود */
  @Get()
  @Permissions(PERMS.CONTRACT_VIEW)
  @RequiresFeature(FEATURES.CONTRACTS_MODULE) // ✅ حماية عرض القائمة
  findAll(@CurrentTenantId() tenantId: string) {
    return this.contractsService.findAll(tenantId);
  }

  /** عقد واحد */
  @Get(':id')
  @Permissions(PERMS.CONTRACT_VIEW)
  @RequiresFeature(FEATURES.CONTRACTS_MODULE) // ✅ حماية عرض التفاصيل
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.contractsService.findOne(id, tenantId);
  }

  /** تعديل عقد */
  @Patch(':id')
  @Permissions(PERMS.CONTRACT_UPDATE)
  @RequiresFeature(FEATURES.CONTRACTS_MODULE) // ✅ حماية التعديل
  update(
    @Param('id') id: string,
    @Body() dto: UpdateContractDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.contractsService.update(id, dto, tenantId);
  }

  /** حذف عقد */
  @Delete(':id')
  @Permissions(PERMS.CONTRACT_DELETE)
  @RequiresFeature(FEATURES.CONTRACTS_MODULE) // ✅ حماية الحذف
  remove(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.contractsService.remove(id, tenantId);
  }
}
