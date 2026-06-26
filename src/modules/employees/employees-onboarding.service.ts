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
import { PermissionScope } from '../permissions/entities/permission.entity';

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

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,

    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,

    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,

    @InjectRepository(Salary)
    private readonly salaryRepo: Repository<Salary>,
  ) {}

  async onboard(
    dto: OnboardEmployeeDto,
    tenantId: string,
    currentUser: CurrentUserData,
  ): Promise<OnboardingResult> {
    if (dto.user?.email) {
      const emailExists = await this.userRepo.findOne({
        where: { email: dto.user.email },
      });
      if (emailExists) {
        throw new ConflictException(
          `البريد الإلكتروني "${dto.user.email}" مستخدم بالفعل`,
        );
      }
    }

    if (dto.nationalId) {
      const nationalIdExists = await this.employeeRepo.findOne({
        where: { nationalId: dto.nationalId, tenantId },
      });
      if (nationalIdExists) {
        throw new ConflictException(
          `رقم الهوية "${dto.nationalId}" مستخدم بالفعل`,
        );
      }
    }

    return await this.dataSource.transaction(async (manager: EntityManager) => {
      const result: OnboardingResult = {} as OnboardingResult;

      let role: Role | undefined;

      if (dto.user) {
        if (dto.user.roleId) {
          const existingRole = await manager.findOne(Role, {
            where: { id: dto.user.roleId },
            relations: ['permissions'],
          });
          if (!existingRole) {
            throw new NotFoundException(
              `الدور بالمعرف "${dto.user.roleId}" غير موجود`,
            );
          }
          role = existingRole;
        } else if (dto.user.roleName) {
          const permissions =
            dto.user.permissionIds && dto.user.permissionIds.length > 0
              ? await manager.find(Permission, {
                  where: { id: In(dto.user.permissionIds) },
                })
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
          role: role,
          status: UserStatus.ACTIVE,
          isSuperAdmin: false,
          isSystemAdmin: false,
        });

        user = await manager.save(User, newUser);
        result.user = user;
      }

      const employeeCode = await this.generateEmployeeCode(tenantId, manager);

      // ✅ إنشاء الموظف مع صورة الهوية
      const newEmployee = manager.create(Employee, {
        fullName: dto.fullName,
        nationalityType: dto.nationalityType,
        iqamaExpiryDate: dto.iqamaExpiryDate
          ? new Date(dto.iqamaExpiryDate)
          : undefined,
        nationalId: dto.nationalId,
        nationalIdCardPath: dto.nationalIdCardPath,
        phone: dto.phone,
        jobTitle: dto.jobTitle,
        department: dto.department,
        shiftId: dto.shiftId,
        status: dto.status ?? 'active',
        employeeCode,
        tenantId,
        user: user,
      });

      const savedEmployee = await manager.save(Employee, newEmployee);
      result.employee = savedEmployee;

      // ✅ إنشاء العقد مع المرفقات
      if (dto.contract) {
        const newContract = manager.create(Contract, {
          contractType: dto.contract.contractType,
          startDate: new Date(dto.contract.startDate),
          endDate: dto.contract.endDate
            ? new Date(dto.contract.endDate)
            : undefined,
          annualLeaveDays: dto.contract.annualLeaveDays ?? 30,
          notes: dto.contract.notes,
          attachmentPaths: dto.contract.attachmentPaths, // <--- تمرير المرفقات
          employeeId: savedEmployee.id,
          tenantId,
        });

        result.contract = await manager.save(Contract, newContract);
      }

      if (dto.salary) {
        if (!dto.salary.basicSalary || dto.salary.basicSalary <= 0) {
          throw new BadRequestException(
            'الراتب الأساسي يجب أن يكون أكبر من صفر',
          );
        }

        const totalSalary =
          Number(dto.salary.basicSalary) +
          Number(dto.salary.housingAllowance ?? 0) +
          Number(dto.salary.transportAllowance ?? 0) +
          Number(dto.salary.otherAllowances ?? 0);

        const newSalary = manager.create(Salary, {
          employeeId: savedEmployee.id,
          basicSalary: dto.salary.basicSalary,
          housingAllowance: dto.salary.housingAllowance ?? 0,
          transportAllowance: dto.salary.transportAllowance ?? 0,
          otherAllowances: dto.salary.otherAllowances ?? 0,
          totalSalary,
          tenantId,
        });

        result.salary = await manager.save(Salary, newSalary);
      }

      return result;
    });
  }

  private readonly TENANT_PREFIX_DIGITS = 3;
  private readonly SEQUENCE_DIGITS = 4;

  private getTenantPrefix(tenantId: string): string {
    const mod = 10 ** this.TENANT_PREFIX_DIGITS;
    let hash = 0;
    for (let i = 0; i < tenantId.length; i++) {
      hash = (hash * 31 + tenantId.charCodeAt(i)) % mod;
    }
    return hash.toString().padStart(this.TENANT_PREFIX_DIGITS, '0');
  }

  private async generateEmployeeCode(
    tenantId: string,
    manager: EntityManager,
  ): Promise<string> {
    const prefix = this.getTenantPrefix(tenantId);
    const totalLength = this.TENANT_PREFIX_DIGITS + this.SEQUENCE_DIGITS;

    const employees = await manager.find(Employee, {
      where: { tenantId },
      select: ['employeeCode'],
      withDeleted: true,
    });

    let maxNumber = 0;
    for (const emp of employees) {
      const code = emp.employeeCode;
      if (!code) continue;
      if (code.length === totalLength && code.startsWith(prefix)) {
        const num = parseInt(code.slice(this.TENANT_PREFIX_DIGITS), 10);
        if (!isNaN(num) && num > maxNumber) maxNumber = num;
      }
    }

    const nextNumber = (maxNumber + 1)
      .toString()
      .padStart(this.SEQUENCE_DIGITS, '0');

    return `${prefix}${nextNumber}`;
  }
}
