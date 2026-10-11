import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  EmployeesService,
  type EmployeeFilterOptions,
} from './employees.service';
import { Employee, NationalityType } from './entities/employee.entity';
import { EmployeesOnboardingService } from './employees-onboarding.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { OnboardEmployeeDto } from './dto/onboard-employee.dto';
import { EmployeeFilterDto } from './dto/employee-filter.dto';
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
import {
  DETAIL_COLUMNS,
  ReportService,
  type ReportColumn,
  type ReportRow,
} from '../../common/reports/report.service';
import { PERMS } from '../../common/constants/permissions';
import { FEATURES } from '../../common/constants/features';
import { formatAmount, formatDate } from '../../common/utils/format.util';

const EMPLOYEE_STATUS_LABELS: Record<Employee['status'], string> = {
  active: 'نشط',
  inactive: 'غير نشط',
  terminated: 'منهي الخدمة',
};

const NATIONALITY_TYPE_LABELS: Partial<Record<NationalityType, string>> = {
  [NationalityType.SAUDI]: 'سعودي',
  [NationalityType.NON_SAUDI]: 'غير سعودي',
};

const EMPLOYEE_LIST_COLUMNS: ReportColumn[] = [
  { header: 'الاسم الكامل', key: 'fullName' },
  { header: 'كود الموظف', key: 'employeeCode' },
  { header: 'القسم', key: 'departmentName' },
  { header: 'حالة الجنسية', key: 'nationalityTypeLabel' },
  { header: 'تاريخ انتهاء الهوية', key: 'iqamaExpiryDate' },
  { header: 'رقم الهوية', key: 'nationalId' },
  { header: 'المسمى الوظيفي', key: 'jobTitle' },
  { header: 'الحالة', key: 'statusLabel' },
];

/** صف الموظف في تقارير القوائم (التصدير الكامل والمُفلتر) */
const toEmployeeListRow = (emp: Employee): ReportRow => ({
  fullName: emp.fullName,
  employeeCode: emp.employeeCode,
  departmentName: emp.department?.name || '-',
  nationalityTypeLabel:
    NATIONALITY_TYPE_LABELS[emp.nationalityType] ?? 'خارج الكفالة',
  iqamaExpiryDate: emp.iqamaExpiryDate ? formatDate(emp.iqamaExpiryDate) : '-',
  nationalId: emp.nationalId || '-',
  jobTitle: emp.jobTitle || '-',
  statusLabel: EMPLOYEE_STATUS_LABELS[emp.status],
});

/** تحويل Query params (نصوص) إلى خيارات الفلترة المستخدمة في الـ Service */
const toFilterOptions = (query: EmployeeFilterDto): EmployeeFilterOptions => ({
  status: query.status,
  nationalityType: query.nationalityType,
  departmentId: query.departmentId,
  shiftId: query.shiftId,
  hasUser: query.hasUser !== undefined ? query.hasUser === 'true' : undefined,
  hasContract:
    query.hasContract !== undefined ? query.hasContract === 'true' : undefined,
  iqamaExpiringSoon: query.iqamaExpiringSoon === 'true',
  search: query.search,
});

@Controller('employees')
@UseGuards(JwtAuthGuard, SubscriptionGuard, PermissionsGuard)
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

  // ✅ الفلترة المتقدمة — لازم تكون قبل route ':id'
  @Get('filter')
  @Permissions(PERMS.EMPLOYEE_VIEW)
  @RequiresFeature(FEATURES.EMPLOYEES_MODULE)
  findFiltered(
    @Query() query: EmployeeFilterDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.employeesService.findFiltered(tenantId, toFilterOptions(query));
  }

  // ✅ تصدير نتائج الفلترة المتقدمة — قبل route ':id' أيضاً
  @Get('export-filtered/:type')
  @Permissions(PERMS.EMPLOYEE_EXPORT)
  @RequiresFeature(FEATURES.REPORTS_EXPORT)
  async exportFiltered(
    @Param('type') type: string,
    @Query() query: EmployeeFilterDto,
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.employeesService.findFiltered(
      tenantId,
      toFilterOptions(query),
    );

    const columns = EMPLOYEE_LIST_COLUMNS;
    const formattedData = data.map(toEmployeeListRow);

    return this.reportService.sendReport(res, type, {
      rows: formattedData,
      columns,
      title: 'تقرير الموظفين (نتائج الفلترة)',
      filename: 'employees_filtered',
    });
  }

  @Get('export/:type')
  @Permissions(PERMS.EMPLOYEE_EXPORT)
  @RequiresFeature(FEATURES.REPORTS_EXPORT)
  async exportEmployees(
    @Param('type') type: string,
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const data = await this.employeesService.findAll(tenantId);
    const columns = EMPLOYEE_LIST_COLUMNS;
    const formattedData = data.map(toEmployeeListRow);

    return this.reportService.sendReport(res, type, {
      rows: formattedData,
      columns,
      title: 'تقرير الموظفين',
      filename: 'employees',
    });
  }

  @Get(':id/export/:type')
  @Permissions(PERMS.EMPLOYEE_EXPORT)
  @RequiresFeature(FEATURES.REPORTS_EXPORT)
  async exportSingleEmployee(
    @Param('id') id: string,
    @Param('type') type: string,
    @CurrentTenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const employee = await this.employeesService.findOne(id, tenantId);

    const reportData: ReportRow[] = [
      { label: 'الاسم الكامل', value: employee.fullName },
      { label: 'كود الموظف', value: employee.employeeCode },
      {
        label: 'الحالة',
        value: EMPLOYEE_STATUS_LABELS[employee.status],
      },
      { label: 'رقم الهوية', value: employee.nationalId || '-' },
      { label: 'الهاتف', value: employee.phone || '-' },
      { label: 'المسمى الوظيفي', value: employee.jobTitle || '-' },
      { label: 'القسم', value: employee.department?.name || '-' },

      ...(employee.contract
        ? [
            { label: 'نوع العقد', value: employee.contract.contractType },
            {
              label: 'تاريخ البداية',
              value: formatDate(employee.contract.startDate),
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
              value: `${formatAmount(employee.salaries[0].basicSalary)} ر.س`,
            },
            {
              label: 'بدل السكن',
              value: `${formatAmount(employee.salaries[0].housingAllowance)} ر.س`,
            },
            {
              label: 'إجمالي الراتب',
              value: `${formatAmount(employee.salaries[0].totalSalary)} ر.س`,
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
          label: `سلفة (${formatDate(adv.createdAt)})`,
          value: `${formatAmount(adv.amount)} ر.س (${adv.status})`,
        });
      });
    }

    if (employee.loans?.length) {
      reportData.push({ label: '--- القروض ---', value: '' });
      employee.loans.forEach((loan) => {
        reportData.push({
          label: `قرض (${formatDate(loan.startDate)})`,
          value: `${formatAmount(loan.totalAmount)} ر.س / ${loan.installmentsCount} قسط`,
        });
      });
    }

    const columns = DETAIL_COLUMNS;

    return this.reportService.sendReport(res, type, {
      rows: reportData,
      columns,
      title: `ملف الموظف: ${employee.fullName}`,
      filename: `employee_${employee.employeeCode}`,
    });
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
