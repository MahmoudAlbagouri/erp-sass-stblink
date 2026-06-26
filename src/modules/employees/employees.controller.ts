// src/modules/employees/employees.controller.ts
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
import { EmployeesService } from './employees.service';
import { EmployeesOnboardingService } from './employees-onboarding.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { OnboardEmployeeDto } from './dto/onboard-employee.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import {
  CurrentUser,
  type CurrentUserData,
} from '../../common/decorators/current-user.decorator';
import { ReportService } from '../../common/reports/report.service';
// ✅ استيراد الثوابت
import { PERMS } from 'src/common/constants/permissions';

@Controller('employees')
@UseGuards(JwtAuthGuard)
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly reportService: ReportService,
    private readonly employeesOnboardingService: EmployeesOnboardingService,
  ) {}

  // ─── مسار الـ Onboarding المجمع ──────────────────────────────────────────
  @Post('onboard')
  @Permissions(PERMS.EMPLOYEE_ONBOARD)
  @UseGuards(PermissionsGuard)
  async onboard(
    @Body() dto: OnboardEmployeeDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    console.log('Received tenantId:', tenantId);
    if (!tenantId) throw new BadRequestException('Tenant ID is missing');

    return await this.employeesOnboardingService.onboard(
      dto,
      tenantId,
      currentUser,
    );
  }

  // ─── المسارات التقليدية ──────────────────────────────────────────────────
  @Post()
  @Permissions(PERMS.EMPLOYEE_CREATE)
  @UseGuards(PermissionsGuard)
  create(@Body() dto: CreateEmployeeDto, @CurrentTenantId() tenantId: string) {
    return this.employeesService.create(dto, tenantId);
  }

  @Get('export/:type')
  @Permissions(PERMS.EMPLOYEE_EXPORT)
  @UseGuards(PermissionsGuard)
  async exportEmployees(
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.employeesService.findAll(tenantId);

    const columns = [
      { header: 'الاسم الكامل', key: 'fullName' },
      { header: 'كود الموظف', key: 'employeeCode' },
      { header: 'نوع الجنسية', key: 'nationalityTypeLabel' },
      { header: 'تاريخ انتهاء الإقامة', key: 'iqamaExpiryDate' },
      { header: 'رقم الهوية', key: 'nationalId' },
      { header: 'رقم الهاتف', key: 'phone' },
      { header: 'المسمى الوظيفي', key: 'jobTitle' },
      { header: 'القسم', key: 'department' },
      { header: 'الحالة', key: 'statusLabel' },
    ];

    const formattedData = data.map((emp) => ({
      fullName: emp.fullName,
      employeeCode: emp.employeeCode,
      nationalityTypeLabel:
        String(emp.nationalityType) === 'saudi'
          ? 'سعودي'
          : String(emp.nationalityType) === 'non_saudi'
            ? 'غير سعودي'
            : 'خارج الكفالة',
      iqamaExpiryDate: emp.iqamaExpiryDate
        ? new Date(emp.iqamaExpiryDate).toLocaleDateString('ar-SA')
        : '-',
      nationalId: emp.nationalId || '-',
      phone: emp.phone || '-',
      jobTitle: emp.jobTitle || '-',
      department: emp.department || '-',
      statusLabel:
        emp.status === 'active'
          ? 'نشط'
          : emp.status === 'inactive'
            ? 'غير نشط'
            : 'منهي الخدمة',
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
        'attachment; filename=employees.xlsx',
      );
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        formattedData,
        columns,
        'تقرير الموظفين',
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename=employees.pdf',
      );
      return res.send(buffer);
    }
  }

  @Get()
  @Permissions(PERMS.EMPLOYEE_VIEW)
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.employeesService.findAll(tenantId);
  }

  @Get(':id')
  @Permissions(PERMS.EMPLOYEE_VIEW)
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.employeesService.findOne(id, tenantId);
  }

  @Patch(':id')
  @Permissions(PERMS.EMPLOYEE_UPDATE)
  @UseGuards(PermissionsGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.employeesService.update(id, dto, tenantId);
  }

  @Delete(':id')
  @Permissions(PERMS.EMPLOYEE_DELETE)
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.employeesService.remove(id, tenantId);
  }
}
