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
import type { Response } from 'express';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { ReportService } from '../../common/reports/report.service'; // ✅ استيراد خدمة التقارير

@Controller('contracts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly reportService: ReportService, // ✅ حقن الخدمة
  ) {}

  @Post()
  @Permissions('create_contract')
  create(@Body() dto: CreateContractDto, @CurrentTenantId() tenantId: string) {
    return this.contractsService.create(dto, tenantId);
  }

  // ✅ مسار التصدير الجديد للعقود
  @Get('export/:type')
  @Permissions('view_contracts')
  async exportContracts(
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.contractsService.findAll(tenantId);

    // تعريف أعمدة التقرير الخاصة بالعقود
    const columns = [
      { header: 'اسم الموظف', key: 'employeeFullName' },
      { header: 'نوع العقد', key: 'contractType' },
      { header: 'تاريخ البدء', key: 'startDate' },
      { header: 'تاريخ الانتهاء', key: 'endDate' },
      { header: 'أيام الإجازة السنوية', key: 'annualLeaveDays' },
      { header: 'ملاحظات', key: 'notes' },
      { header: 'تاريخ الإنشاء', key: 'createdAt' },
    ];

    // تحضير البيانات لتتناسب مع مفاتيح الأعمدة
    const formattedData = data.map((contract) => ({
      employeeFullName: contract.employee?.fullName || '-',
      contractType: contract.contractType,
      startDate: new Date(contract.startDate).toLocaleDateString('ar-SA'),
      endDate: contract.endDate
        ? new Date(contract.endDate).toLocaleDateString('ar-SA')
        : 'غير محدد',
      annualLeaveDays: contract.annualLeaveDays,
      notes: contract.notes || '-',
      createdAt: new Date(contract.createdAt).toLocaleDateString('ar-SA'),
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

  @Get()
  @Permissions('view_contracts')
  findAll(@CurrentTenantId() tenantId: string) {
    return this.contractsService.findAll(tenantId);
  }

  @Get(':id')
  @Permissions('view_contracts')
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.contractsService.findOne(id, tenantId);
  }

  @Patch(':id')
  @Permissions('update_contract')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateContractDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.contractsService.update(id, dto, tenantId);
  }

  @Delete(':id')
  @Permissions('delete_contract')
  remove(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.contractsService.remove(id, tenantId);
  }
}
