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
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { ReportService } from '../../common/reports/report.service';

@Controller('employees')
@UseGuards(JwtAuthGuard)
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly reportService: ReportService,
  ) {}

  @Post()
  @Permissions('create_employee')
  @UseGuards(PermissionsGuard)
  create(@Body() dto: CreateEmployeeDto, @CurrentTenantId() tenantId: string) {
    return this.employeesService.create(dto, tenantId);
  }

  @Get('export/:type')
  @Permissions('view_employees') // أو 'export_employees' حسب نظام الصلاحيات لديك
  @UseGuards(PermissionsGuard)
  async exportEmployees(
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.employeesService.findAll(tenantId);

    // تعريف أعمدة التقرير ديناميكياً
    const columns = [
      { header: 'الاسم الكامل', key: 'fullName' },
      { header: 'كود الموظف', key: 'employeeCode' },
      { header: 'الرقم الوطني', key: 'nationalId' },
      { header: 'رقم الهاتف', key: 'phone' },
      { header: 'المسمى الوظيفي', key: 'jobTitle' },
      { header: 'القسم', key: 'department' },
      { header: 'تاريخ التوظيف', key: 'hireDate' },
      { header: 'الحالة', key: 'status' },
    ];

    if (type === 'excel') {
      const buffer = await this.reportService.generateExcel(data, columns);
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
        data,
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
  @Permissions('view_employees')
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.employeesService.findAll(tenantId);
  }

  @Get(':id')
  @Permissions('view_employees')
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.employeesService.findOne(id, tenantId);
  }

  @Patch(':id')
  @Permissions('update_employee')
  @UseGuards(PermissionsGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.employeesService.update(id, dto, tenantId);
  }

  @Delete(':id')
  @Permissions('delete_employee')
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.employeesService.remove(id, tenantId);
  }
}
