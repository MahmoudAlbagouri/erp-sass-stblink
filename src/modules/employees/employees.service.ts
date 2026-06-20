// src/modules/employees/employees.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

  private async generateEmployeeCode(tenantId: string): Promise<string> {
    const lastEmployee = await this.repo.findOne({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });

    let nextNumber = 1;
    if (lastEmployee?.employeeCode) {
      const match = lastEmployee.employeeCode.match(/(\d+)/);
      if (match) nextNumber = parseInt(match[1], 10) + 1;
    }
    return `${nextNumber.toString().padStart(4, '0')}`;
  }

  async create(dto: CreateEmployeeDto, tenantId: string): Promise<Employee> {
    let user: User | null = null;
    if (dto.userId) {
      user = await this.userRepo.findOneBy({ id: dto.userId, tenantId });
      if (!user)
        throw new NotFoundException('المستخدم غير موجود أو لا ينتمي لشركتك');
    }

    const employeeCode =
      dto.employeeCode || (await this.generateEmployeeCode(tenantId));

    const employee = this.repo.create({
      ...dto,
      employeeCode,
      user: user ?? undefined,
      tenantId,
      // تحويل التاريخ إلى كائن Date إذا كان موجوداً
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

    if (dto.userId && dto.userId !== employee.user?.id) {
      const user = await this.userRepo.findOneBy({ id: dto.userId, tenantId });
      if (!user) throw new NotFoundException('المستخدم المحدد غير موجود');
      employee.user = user;
    }

    Object.assign(employee, dto);

    // معالجة تاريخ الإقامة عند التحديث
    if (dto.iqamaExpiryDate) {
      employee.iqamaExpiryDate = new Date(dto.iqamaExpiryDate);
    } else if (
      dto.iqamaExpiryDate === null ||
      dto.iqamaExpiryDate === undefined
    ) {
      // تعيينها undefined لضمان حذفها من قاعدة البيانات إذا كانت مطلوبة
      employee.iqamaExpiryDate = undefined;
    }

    return await this.repo.save(employee);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const employee = await this.findOne(id, tenantId);
    await this.repo.softRemove(employee);
  }
}
