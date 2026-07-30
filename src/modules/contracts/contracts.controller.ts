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
  BadRequestException,
} from '@nestjs/common';
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
import { ReportService } from '../../common/reports/report.service';
import { PERMS } from 'src/common/constants/permissions';
import { FEATURES } from 'src/common/constants/features'; // ✅ استيراد الثوابت

@Controller('contracts')
@UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard) // ✅ تفعيل حراس الاشتراك والصلاحيات
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly reportService: ReportService,
  ) {}

  @Post()
  @Permissions(PERMS.CONTRACT_CREATE)
  @RequiresFeature(FEATURES.CONTRACTS_MODULE) // ✅ التحقق من توفر الموديول في الخطة
  create(@Body() dto: CreateContractDto, @CurrentTenantId() tenantId: string) {
    return this.contractsService.create(dto, tenantId);
  }

  // ✅ مسار التصدير الجماعي للعقود
  @Get('export/:type')
  @Permissions(PERMS.CONTRACT_EXPORT)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  async exportContracts(
    @Param('type') type: 'excel' | 'pdf',
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
      startDate: new Date(contract.startDate).toLocaleDateString('ar-SA'),
      endDate: contract.endDate
        ? new Date(contract.endDate).toLocaleDateString('ar-SA')
        : 'غير محدد',
      durationYears: contract.contractDurationYears
        ? `${contract.contractDurationYears} سنوات`
        : '-',
      annualLeaveDays: `${contract.annualLeaveDays} يوم`,
      medicalInsurance: contract.medicalInsurance || '-',
      ticketType: contract.ticketType || '-',
      probationPeriod: contract.probationPeriod || '-',
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
        'attachment; filename=contracts.xlsx',
      );
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        formattedData,
        columns,
        'تقرير العقود',
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=contracts.pdf',
      );
      return res.send(buffer);
    }
  }

  // ✅ مسار التصدير الفردي لعقد واحد (يجب أن يكون قبل findOne)
  @Get(':id/export/:type')
  @Permissions(PERMS.CONTRACT_EXPORT)
  @RequiresFeature(FEATURES.REPORTS_EXPORT) // ✅ التحقق من ميزة التصدير
  async exportSingleContract(
    @Param('id') id: string,
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const contract = await this.contractsService.findOne(id, tenantId);
    if (!contract) throw new BadRequestException('العقد غير موجود');

    const reportData: any[] = [
      { label: 'اسم الموظف', value: contract.employee?.fullName || '-' },
      { label: 'كود الموظف', value: contract.employee?.employeeCode || '-' },
      { label: 'المسمى الوظيفي', value: contract.employee?.jobTitle || '-' },
      { label: 'القسم', value: contract.employee?.department || '-' },
      { label: 'نوع العقد', value: contract.contractType },
      {
        label: 'تاريخ البداية',
        value: new Date(contract.startDate).toLocaleDateString('ar-SA'),
      },
      {
        label: 'تاريخ النهاية',
        value: contract.endDate
          ? new Date(contract.endDate).toLocaleDateString('ar-SA')
          : 'غير محدد',
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
        value: new Date(contract.createdAt).toLocaleDateString('ar-SA'),
      },
    ];

    if (contract.notes) {
      reportData.push({ label: 'ملاحظات العقد', value: contract.notes });
    }

    if (contract.attachmentPaths && contract.attachmentPaths.length > 0) {
      reportData.push({ label: '--- المرفقات ---', value: '' });
      contract.attachmentPaths.forEach((path, i) => {
        reportData.push({ label: `مرفق #${i + 1}`, value: path });
      });
    }

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
        `attachment; filename=contract_${contract.employee?.employeeCode || id}.xlsx`,
      );
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        reportData,
        columns,
        `عقد الموظف: ${contract.employee?.fullName}`,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=contract_${contract.employee?.employeeCode || id}.pdf`,
      );
      return res.send(buffer);
    }

    throw new BadRequestException('نوع التصدير غير مدعوم');
  }

  @Get()
  @Permissions(PERMS.CONTRACT_VIEW)
  @RequiresFeature(FEATURES.CONTRACTS_MODULE) // ✅ حماية عرض القائمة
  findAll(@CurrentTenantId() tenantId: string) {
    return this.contractsService.findAll(tenantId);
  }

  @Get(':id')
  @Permissions(PERMS.CONTRACT_VIEW)
  @RequiresFeature(FEATURES.CONTRACTS_MODULE) // ✅ حماية عرض التفاصيل
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.contractsService.findOne(id, tenantId);
  }

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

  @Delete(':id')
  @Permissions(PERMS.CONTRACT_DELETE)
  @RequiresFeature(FEATURES.CONTRACTS_MODULE) // ✅ حماية الحذف
  remove(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.contractsService.remove(id, tenantId);
  }
}
