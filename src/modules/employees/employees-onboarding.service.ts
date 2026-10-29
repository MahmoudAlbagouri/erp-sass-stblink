// src/modules/employees/employees-onboarding.service.ts
import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In, EntityManager } from 'typeorm';
import * as argon2 from 'argon2';

import { Employee } from './entities/employee.entity';
import { User } from '../users/entities/user.entity';
import { Role } from '../roles/entities/role.entity';
import { Permission } from '../permissions/entities/permission.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { Salary } from '../salaries/entities/salary.entity';
import { OnboardEmployeeDto } from './dto/onboard-employee.dto';
import { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { UserStatus } from '../../common/enums/user.enums';
import { PaymentMethodEnum } from '../../common/enums/salary.enums';
import { normalizeIban } from '../../common/utils/iban.util';
import { PermissionScope } from '../permissions/entities/permission.entity';
import {
  calculateContractEndDate,
  calculateProbationEndDate,
} from '../contracts/utils/contract-dates.util';
import { filterTenantAssignablePermissions } from '../permissions/utils/permission-scope.util';
import { generateEmployeeCode } from './utils/employee-code.util';
import {
  resolveBranchId,
  resolveUserBranches,
} from '../branches/branches.util';

import { DomainEvents } from '../../common/events/domain-events';
import { FilesService } from '../files/files.service';
import { employeeFileIds } from './employees.service';

export interface OnboardingResult {
  employee: Employee;
  user?: User;
  role?: Role;
  contract?: Contract;
  salary?: Salary;
}

@Injectable()
export class EmployeesOnboardingService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Employee)
    private readonly employeeRepo: Repository<Employee>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly events: DomainEvents,
    private readonly files: FilesService,
  ) {}

  async onboard(
    dto: OnboardEmployeeDto,
    tenantId: string,
    currentUser: CurrentUserData,
  ): Promise<OnboardingResult> {
    // ... التحقق من البريد والهوية (نفس الكود السابق) ...

    if (dto.user?.email) {
      const emailExists = await this.userRepo.findOne({
        where: { email: dto.user.email },
      });
      if (emailExists)
        throw new ConflictException(
          `البريد الإلكتروني "${dto.user.email}" مستخدم بالفعل`,
        );
    }

    if (dto.nationalId) {
      const nationalIdExists = await this.employeeRepo.findOne({
        where: { nationalId: dto.nationalId, tenantId },
      });
      if (nationalIdExists)
        throw new ConflictException(
          `رقم الهوية "${dto.nationalId}" مستخدم بالفعل`,
        );
    }

    // الهوية والشهادات ومرفقات العقد: ملفات مرفوعة لهذه الشركة فقط
    await this.files.assertOwned(employeeFileIds(dto), tenantId);
    const contractFiles = await this.files.resolve(
      dto.contract?.attachmentFileIds ?? [],
      tenantId,
    );

    // ✅ تنفيذ الـ Transaction وحفظ النتيجة
    const result = await this.dataSource.transaction(
      async (manager: EntityManager) => {
        // ... كل كود الـ transaction السابق كما هو بدون تغيير ...
        // (نفس المنطق الموجود عندك تماماً)

        const result: OnboardingResult = {} as OnboardingResult;

        let role: Role | undefined;
        if (dto.user) {
          if (dto.user.roleId) {
            const existingRole = await manager.findOne(Role, {
              where: { id: dto.user.roleId },
              relations: ['permissions'],
            });
            // ✅ عزل الشركات: لا يُسمح بإسناد دور يخص شركة أخرى
            if (
              !existingRole ||
              (existingRole.tenantId && existingRole.tenantId !== tenantId)
            )
              throw new NotFoundException(
                `الدور بالمعرف "${dto.user.roleId}" غير موجود`,
              );
            role = existingRole;
          } else if (dto.user.roleName) {
            // ✅ استبعاد صلاحيات system: وصلاحيات الشركات الأخرى
            const permissions = dto.user.permissionIds?.length
              ? filterTenantAssignablePermissions(
                  await manager.find(Permission, {
                    where: { id: In(dto.user.permissionIds) },
                  }),
                  tenantId,
                )
              : [];
            const newRole = manager.create(Role, {
              name: dto.user.roleName,
              scope: PermissionScope.TENANT,
              tenantId,
              permissions,
            });
            role = await manager.save(Role, newRole);
            result.role = role;
          }
        }

        let user: User | undefined;
        if (dto.user) {
          const hashedPassword = await argon2.hash(dto.user.password);
          const newUser = manager.create(User, {
            username: dto.user.username,
            email: dto.user.email,
            password: hashedPassword,
            tenantId,
            role,
            status: UserStatus.ACTIVE,
            isSuperAdmin: false,
            isSystemAdmin: false,
            // من ينشئه مستخدم مقيَّد بفروع يرث فروعه: لا يرى أكثر ممن أنشأه
            branches: await resolveUserBranches(manager, tenantId),
          });
          user = await manager.save(User, newUser);
          result.user = user;
        }

        const employeeCode = await generateEmployeeCode(
          manager.getRepository(Employee),
          tenantId,
        );

        const processedEducations = dto.educations?.map((edu) => ({
          ...edu,
          expiryDate: edu.expiryDate ? new Date(edu.expiryDate) : undefined,
        }));

        const newEmployee = manager.create(Employee, {
          fullName: dto.fullName,
          nationalityType: dto.nationalityType,
          iqamaExpiryDate: dto.iqamaExpiryDate
            ? new Date(dto.iqamaExpiryDate)
            : undefined,
          nationalId: dto.nationalId,
          nationalIdCardFileId: dto.nationalIdCardFileId,
          phone: dto.phone,
          jobTitle: dto.jobTitle,
          departmentId: dto.departmentId, // ✅ بدل department النصي
          branchId: await resolveBranchId(manager, tenantId, dto.branchId),
          shiftId: dto.shiftId,
          status: dto.status ?? 'active',
          employeeCode,
          tenantId,
          user,
          educations: processedEducations,
        });
        const savedEmployee = await manager.save(Employee, newEmployee);
        result.employee = savedEmployee;

        if (dto.contract) {
          const startDate = new Date(dto.contract.startDate);
          const probationEndDate = calculateProbationEndDate(
            startDate,
            dto.contract.probationPeriod,
          );
          const calculatedEndDate = calculateContractEndDate(
            startDate,
            dto.contract.endDate,
            dto.contract.contractDurationMonths,
          );

          const newContract = manager.create(Contract, {
            contractType: dto.contract.contractType,
            startDate,
            endDate: calculatedEndDate,
            annualLeaveDays: dto.contract.annualLeaveDays ?? 30,
            contractDurationYears: dto.contract.contractDurationMonths
              ? Math.floor(dto.contract.contractDurationMonths / 12)
              : undefined,
            ticketType: dto.contract.ticketType,
            probationPeriod: dto.contract.probationPeriod,
            probationEndDate,
            medicalInsurance: dto.contract.medicalInsurance,
            nationality: dto.contract.nationality,
            notes: dto.contract.notes,
            attachments: contractFiles,
            employeeId: savedEmployee.id,
            tenantId,
          });
          result.contract = await manager.save(Contract, newContract);
        }

        if (dto.salary) {
          if (!dto.salary.basicSalary || dto.salary.basicSalary <= 0)
            throw new BadRequestException(
              'الراتب الأساسي يجب أن يكون أكبر من صفر',
            );

          const totalSalary =
            Number(dto.salary.basicSalary) +
            Number(dto.salary.housingAllowance ?? 0) +
            Number(dto.salary.transportAllowance ?? 0) +
            Number(dto.salary.otherAllowances ?? 0);

          // ✅ الآيبان يُحفظ فقط عند الدفع البنكي
          const isBank = dto.salary.paymentMethod === PaymentMethodEnum.BANK;

          const newSalary = manager.create(Salary, {
            employeeId: savedEmployee.id,
            basicSalary: dto.salary.basicSalary,
            housingAllowance: dto.salary.housingAllowance ?? 0,
            transportAllowance: dto.salary.transportAllowance ?? 0,
            otherAllowances: dto.salary.otherAllowances ?? 0,
            totalSalary,
            paymentMethod: dto.salary.paymentMethod,
            iban: isBank ? normalizeIban(dto.salary.iban) : null,
            tenantId,
          });
          result.salary = await manager.save(Salary, newSalary);
        }

        return result;
      },
    );

    // بعد نجاح المعاملة: الموظف محفوظ فعلاً
    this.events.emit('employee.onboarded', {
      tenantId,
      actorUserId: currentUser.id,
      employeeId: result.employee.id,
      userId: result.user?.id ?? null,
    });

    return result;
  }
}
