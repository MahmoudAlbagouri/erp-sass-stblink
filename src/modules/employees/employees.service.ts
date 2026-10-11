import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from './entities/employee.entity';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { User } from '../users/entities/user.entity';
import { generateEmployeeCode } from './utils/employee-code.util';

export interface EmployeeFilterOptions {
  status?: string;
  nationalityType?: string;
  departmentId?: string;
  shiftId?: string;
  hasUser?: boolean;
  hasContract?: boolean;
  iqamaExpiringSoon?: boolean;
  search?: string;
}

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee) private repo: Repository<Employee>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  private async checkNationalIdUniqueness(
    nationalId: string | undefined,
    tenantId: string,
    excludeId?: string,
  ): Promise<void> {
    if (!nationalId) return;

    const existing = await this.repo.findOne({
      where: { nationalId, tenantId },
    });

    if (existing && existing.id !== excludeId) {
      throw new ConflictException(
        `رقم الهوية "${nationalId}" مستخدم بالفعل من قبل الموظف: ${existing.fullName}`,
      );
    }
  }

  async create(dto: CreateEmployeeDto, tenantId: string): Promise<Employee> {
    await this.checkNationalIdUniqueness(dto.nationalId, tenantId);

    let user: User | null = null;
    if (dto.userId) {
      user = await this.userRepo.findOneBy({ id: dto.userId, tenantId });
      if (!user)
        throw new NotFoundException('المستخدم غير موجود أو لا ينتمي لشركتك');
    }

    const MAX_RETRIES = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const employeeCode = await generateEmployeeCode(this.repo, tenantId);

      const processedEducations = dto.educations?.map((edu) => ({
        ...edu,
        expiryDate: edu.expiryDate ? new Date(edu.expiryDate) : undefined,
      }));

      const employee = this.repo.create({
        ...dto,
        employeeCode,
        user: user ?? undefined,
        tenantId,
        iqamaExpiryDate: dto.iqamaExpiryDate
          ? new Date(dto.iqamaExpiryDate)
          : undefined,
        educations: processedEducations,
      });

      try {
        return await this.repo.save(employee);
      } catch (error: unknown) {
        const pgError = error as { code?: string; detail?: string };
        const isEmployeeCodeConflict =
          pgError.code === '23505' &&
          (pgError.detail?.includes('employeeCode') ||
            pgError.detail?.includes('employee_code'));

        if (!isEmployeeCodeConflict) throw error;
        lastError = error;
      }
    }

    throw lastError;
  }

  async findAll(tenantId: string): Promise<Employee[]> {
    return this.repo.find({
      where: { tenantId },
      relations: ['user', 'educations', 'department', 'contract'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<Employee> {
    const employee = await this.repo.findOne({
      where: { id, tenantId },
      relations: [
        'user',
        'user.role',
        'contract',
        'educations',
        'advances',
        'loans',
        'bonuses',
        'deductions',
        'leaveRequests',
        'settlements',
        'endOfServices',
        'resignationRequests',
        'salaries',
        'shift',
        'department', // ✅
      ],
      order: {
        createdAt: 'DESC',
        leaveRequests: { startDate: 'DESC' },
        salaries: { createdAt: 'DESC' },
      },
    });

    if (!employee) throw new NotFoundException('الموظف غير موجود');
    return employee;
  }

  /**
   * ✅ فلترة متقدمة — تُستخدم في صفحة الموظفين وفي التصدير المُفلتر
   */
  async findFiltered(
    tenantId: string,
    filters: EmployeeFilterOptions,
  ): Promise<Employee[]> {
    const qb = this.repo
      .createQueryBuilder('employee')
      .leftJoinAndSelect('employee.user', 'user')
      .leftJoinAndSelect('employee.department', 'department')
      .leftJoinAndSelect('employee.contract', 'contract')
      .leftJoinAndSelect('employee.shift', 'shift')
      .leftJoinAndSelect('employee.educations', 'educations')
      .where('employee.tenantId = :tenantId', { tenantId });

    if (filters.status) {
      qb.andWhere('employee.status = :status', { status: filters.status });
    }
    if (filters.nationalityType) {
      qb.andWhere('employee.nationalityType = :nationalityType', {
        nationalityType: filters.nationalityType,
      });
    }
    if (filters.departmentId) {
      qb.andWhere('employee.departmentId = :departmentId', {
        departmentId: filters.departmentId,
      });
    }
    if (filters.shiftId) {
      qb.andWhere('employee.shiftId = :shiftId', {
        shiftId: filters.shiftId,
      });
    }
    if (filters.hasUser === true) {
      qb.andWhere('user.id IS NOT NULL');
    } else if (filters.hasUser === false) {
      qb.andWhere('user.id IS NULL');
    }
    if (filters.hasContract === true) {
      qb.andWhere('contract.id IS NOT NULL');
    } else if (filters.hasContract === false) {
      qb.andWhere('contract.id IS NULL');
    }
    if (filters.iqamaExpiringSoon) {
      const now = new Date();
      const in60Days = new Date();
      in60Days.setDate(now.getDate() + 60);
      qb.andWhere('employee.iqamaExpiryDate BETWEEN :now AND :in60Days', {
        now,
        in60Days,
      });
    }
    if (filters.search) {
      qb.andWhere(
        '(employee.fullName ILIKE :search OR employee.employeeCode ILIKE :search OR employee.nationalId ILIKE :search OR employee.jobTitle ILIKE :search OR employee.phone ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    qb.orderBy('employee.createdAt', 'DESC');

    return await qb.getMany();
  }

  async update(
    id: string,
    dto: UpdateEmployeeDto,
    tenantId: string,
  ): Promise<Employee> {
    const employee = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['user', 'educations'],
    });

    if (!employee) throw new NotFoundException('الموظف غير موجود');

    if (dto.nationalId && dto.nationalId !== employee.nationalId) {
      await this.checkNationalIdUniqueness(dto.nationalId, tenantId, id);
    }

    if (dto.userId && dto.userId !== employee.user?.id) {
      const user = await this.userRepo.findOneBy({ id: dto.userId, tenantId });
      if (!user) throw new NotFoundException('المستخدم المحدد غير موجود');
      employee.user = user;
    }

    // ✅ الحقول ذات المعالجة الخاصة تُفصل عن باقي الـ DTO حتى لا يعيد
    // Object.assign الكتابة فوق قيمها المُعالَجة (كان يُرجع educations الخام)
    const { educations, iqamaExpiryDate, ...rest } = dto;
    delete rest.userId; // الربط بالمستخدم تم أعلاه عبر employee.user
    Object.assign(employee, rest);

    if (educations !== undefined) {
      employee.educations = educations.map((edu) => ({
        ...edu,
        expiryDate: edu.expiryDate ? new Date(edu.expiryDate) : undefined,
        employeeId: employee.id,
      })) as Employee['educations'];
    }

    // غياب الحقل = لا تغيير، وقيمة فارغة/null = مسح التاريخ
    if (iqamaExpiryDate !== undefined) {
      employee.iqamaExpiryDate = iqamaExpiryDate
        ? new Date(iqamaExpiryDate)
        : null;
    }

    return await this.repo.save(employee);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const employee = await this.findOne(id, tenantId);
    await this.repo.softRemove(employee);
  }
}
