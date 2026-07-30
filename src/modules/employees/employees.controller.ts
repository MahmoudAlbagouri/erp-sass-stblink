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
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { CheckQuota } from '../../common/decorators/check-quota.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import {
  CurrentUser,
  type CurrentUserData,
} from '../../common/decorators/current-user.decorator';
import { ReportService } from '../../common/reports/report.service';
import { PERMS } from 'src/common/constants/permissions';
import { FEATURES } from 'src/common/constants/features';

@Controller('employees')
@UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard) // ✅ ترتيب صحيح وشامل للـ Guards
export class EmployeesController {
  constructor(
    private readonly employeesService: EmployeesService,
    private readonly reportService: ReportService,
    private readonly employeesOnboardingService: EmployeesOnboardingService,
  ) {}

  @Post('onboard')
  @Permissions(PERMS.EMPLOYEE_ONBOARD)
  @RequiresFeature(FEATURES.EMPLOYEES_MODULE)
  @CheckQuota('max_employees')
  async onboard(
    @Body() dto: OnboardEmployeeDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    if (!tenantId) throw new BadRequestException('Tenant ID is missing');
    return await this.employeesOnboardingService.onboard(
      dto,
      tenantId,
      currentUser,
    );
  }

  @Post()
  @Permissions(PERMS.EMPLOYEE_CREATE)
  @RequiresFeature(FEATURES.EMPLOYEES_MODULE)
  @CheckQuota('max_employees')
  create(@Body() dto: CreateEmployeeDto, @CurrentTenantId() tenantId: string) {
    return this.employeesService.create(dto, tenantId);
  }

  @Get('export/:type')
  @Permissions(PERMS.EMPLOYEE_EXPORT)
  @RequiresFeature(FEATURES.REPORTS_EXPORT)
  async exportEmployees(
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.employeesService.findAll(tenantId);
    const columns = [
      { header: 'الاسم الكامل', key: 'fullName' },
      { header: 'كود الموظف', key: 'employeeCode' },
      { header: 'حالة الموظف', key: 'nationalityTypeLabel' },
      { header: 'تاريخ انتهاء الهوية', key: 'iqamaExpiryDate' },
      { header: 'رقم الهوية', key: 'nationalId' },
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

  @Get(':id/export/:type')
  @Permissions(PERMS.EMPLOYEE_EXPORT)
  @RequiresFeature(FEATURES.REPORTS_EXPORT)
  async exportSingleEmployee(
    @Param('id') id: string,
    @Param('type') type: 'excel' | 'pdf',
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const employee = await this.employeesService.findOne(id, tenantId);
    if (!employee) throw new BadRequestException('الموظف غير موجود');

    const reportData: any[] = [
      { label: 'الاسم الكامل', value: employee.fullName },
      { label: 'كود الموظف', value: employee.employeeCode },
      {
        label: 'الحالة',
        value:
          employee.status === 'active'
            ? 'نشط'
            : employee.status === 'inactive'
              ? 'غير نشط'
              : 'منهي الخدمة',
      },
      { label: 'رقم الهوية', value: employee.nationalId || '-' },
      { label: 'الهاتف', value: employee.phone || '-' },
      { label: 'المسمى الوظيفي', value: employee.jobTitle || '-' },
      { label: 'القسم', value: employee.department || '-' },

      ...(employee.contract
        ? [
            { label: 'نوع العقد', value: employee.contract.contractType },
            {
              label: 'تاريخ البداية',
              value: new Date(employee.contract.startDate).toLocaleDateString(
                'ar-SA',
              ),
            },
            {
              label: 'مدة العقد',
              value: `${employee.contract.contractDurationYears || '-'} سنوات`,
            },
            {
              label: 'التأمين الطبي',
              value: employee.contract.medicalInsurance || '-',
            },
            { label: 'التذكرة', value: employee.contract.ticketType || '-' },
            {
              label: 'فترة التجربة',
              value: employee.contract.probationPeriod || '-',
            },
          ]
        : []),

      ...(employee.salaries && employee.salaries.length > 0
        ? [
            {
              label: 'الراتب الأساسي',
              value: `${Number(employee.salaries[0].basicSalary).toLocaleString('ar-SA')} ر.س`,
            },
            {
              label: 'بدل السكن',
              value: `${Number(employee.salaries[0].housingAllowance).toLocaleString('ar-SA')} ر.س`,
            },
            {
              label: 'إجمالي الراتب',
              value: `${Number(employee.salaries[0].totalSalary).toLocaleString('ar-SA')} ر.س`,
            },
          ]
        : []),
    ];

    if (employee.educations?.length) {
      reportData.push({ label: '--- المؤهلات العلمية ---', value: '' });
      employee.educations.forEach((edu, i) => {
        reportData.push({
          label: `#${i + 1} ${edu.degree}`,
          value: `${edu.issuingAuthority || ''} - ${edu.certificateNumber || ''}`,
        });
      });
    }

    if (employee.advances?.length) {
      reportData.push({ label: '--- السلف المالية ---', value: '' });
      employee.advances.forEach((adv) => {
        reportData.push({
          label: `سلفة (${new Date(adv.createdAt).toLocaleDateString('ar-SA')})`,
          value: `${Number(adv.amount).toLocaleString('ar-SA')} ر.س (${adv.status})`,
        });
      });
    }

    if (employee.loans?.length) {
      reportData.push({ label: '--- القروض ---', value: '' });
      employee.loans.forEach((loan) => {
        reportData.push({
          label: `قرض (${new Date(loan.startDate).toLocaleDateString('ar-SA')})`,
          value: `${Number(loan.totalAmount).toLocaleString('ar-SA')} ر.س / ${loan.installmentsCount} قسط`,
        });
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
        `attachment; filename=employee_${employee.employeeCode}.xlsx`,
      );
      return res.send(buffer);
    }

    if (type === 'pdf') {
      const buffer = await this.reportService.generatePdf(
        reportData,
        columns,
        `ملف الموظف: ${employee.fullName}`,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=employee_${employee.employeeCode}.pdf`,
      );
      return res.send(buffer);
    }

    throw new BadRequestException('نوع التصدير غير مدعوم');
  }

  @Get()
  @Permissions(PERMS.EMPLOYEE_VIEW)
  @RequiresFeature(FEATURES.EMPLOYEES_MODULE)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.employeesService.findAll(tenantId);
  }

  @Get(':id')
  @Permissions(PERMS.EMPLOYEE_VIEW)
  @RequiresFeature(FEATURES.EMPLOYEES_MODULE)
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.employeesService.findOne(id, tenantId);
  }

  @Patch(':id')
  @Permissions(PERMS.EMPLOYEE_UPDATE)
  @RequiresFeature(FEATURES.EMPLOYEES_MODULE)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.employeesService.update(id, dto, tenantId);
  }

  @Delete(':id')
  @Permissions(PERMS.EMPLOYEE_DELETE)
  @RequiresFeature(FEATURES.EMPLOYEES_MODULE)
  remove(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.employeesService.remove(id, tenantId);
  }
}
