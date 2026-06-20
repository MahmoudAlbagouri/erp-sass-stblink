// src/modules/employees/employees.service.ts
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Employee } from './entities/employee.entity';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { User } from '../users/entities/user.entity';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee) private repo: Repository<Employee>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  /**
   * التحقق من عدم تكرار رقم الهوية داخل نفس الشركة
   */
  private async checkNationalIdUniqueness(
    nationalId: string,
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

  /**
   * دالة توليد كود الموظف تلقائياً بناءً على أعلى رقم نشط في نفس الشركة
   */
  private async generateEmployeeCode(tenantId: string): Promise<string> {
    // البحث عن آخر موظف نشط فقط (غير محذوف) مرتباً حسب الكود تنازلياً
    const lastEmployee = await this.repo.findOne({
      where: {
        tenantId,
        deletedAt: IsNull(), // ✅ تجاهل الموظفين المحذوفين نهائياً
      },
      order: { employeeCode: 'DESC' }, // ✅ الترتيب حسب الكود وليس التاريخ
    });

    let nextNumber = 1;
    if (lastEmployee?.employeeCode) {
      const match = lastEmployee.employeeCode.match(/(\d+)/);
      if (match) nextNumber = parseInt(match[1], 10) + 1;
    }
    return `${nextNumber.toString().padStart(4, '0')}`;
  }

  async create(dto: CreateEmployeeDto, tenantId: string): Promise<Employee> {
    // ✅ 1. التحقق من تكرار رقم الهوية أولاً
    await this.checkNationalIdUniqueness(dto.nationalId!, tenantId);

    // التحقق من المستخدم المرتبط إذا تم إرساله
    let user: User | null = null;
    if (dto.userId) {
      user = await this.userRepo.findOneBy({ id: dto.userId, tenantId });
      if (!user)
        throw new NotFoundException('المستخدم غير موجود أو لا ينتمي لشركتك');
    }

    // ✅ 2. توليد كود جديد بناءً على الموظفين النشطين فقط
    const employeeCode = await this.generateEmployeeCode(tenantId);

    const employee = this.repo.create({
      ...dto,
      employeeCode,
      user: user ?? undefined,
      tenantId,
      iqamaExpiryDate: dto.iqamaExpiryDate
        ? new Date(dto.iqamaExpiryDate)
        : undefined,
    });

    return await this.repo.save(employee);
  }

  async findAll(tenantId: string): Promise<Employee[]> {
    return this.repo.find({
      where: { tenantId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<Employee> {
    const employee = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['user', 'contract'],
    });
    if (!employee) throw new NotFoundException('الموظف غير موجود');
    return employee;
  }

  async update(
    id: string,
    dto: UpdateEmployeeDto,
    tenantId: string,
  ): Promise<Employee> {
    const employee = await this.findOne(id, tenantId);

    // ✅ 3. التحقق من تكرار رقم الهوية عند التحديث
    if (dto.nationalId && dto.nationalId !== employee.nationalId) {
      await this.checkNationalIdUniqueness(dto.nationalId, tenantId, id);
    }

    if (dto.userId && dto.userId !== employee.user?.id) {
      const user = await this.userRepo.findOneBy({ id: dto.userId, tenantId });
      if (!user) throw new NotFoundException('المستخدم المحدد غير موجود');
      employee.user = user;
    }

    Object.assign(employee, dto);

    if (dto.iqamaExpiryDate) {
      employee.iqamaExpiryDate = new Date(dto.iqamaExpiryDate);
    } else if (
      dto.iqamaExpiryDate === null ||
      dto.iqamaExpiryDate === undefined
    ) {
      employee.iqamaExpiryDate = undefined;
    }

    return await this.repo.save(employee);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const employee = await this.findOne(id, tenantId);
    await this.repo.softRemove(employee);
  }
}
