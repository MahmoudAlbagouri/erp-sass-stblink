// src/modules/employees/employees.service.ts
import { Injectable, NotFoundException, Inject, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import { Employee } from './entities/employee.entity';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { User } from '../users/entities/user.entity';

interface RequestWithUser extends Request {
  user?: { id: string; tenantId: string };
}

@Injectable({ scope: Scope.REQUEST })
export class EmployeesService {
  constructor(
    @InjectRepository(Employee) private repo: Repository<Employee>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @Inject(REQUEST) private request: RequestWithUser,
  ) {}

  // ✅ دالة مساعدة آمنة لجلب tenantId وتجنب تكرار الكود والأخطاء
  private getTenantId(): string {
    if (!this.request.user?.tenantId) {
      throw new NotFoundException('سياق المستخدم أو الشركة غير موجود');
    }
    return this.request.user.tenantId;
  }

  async create(dto: CreateEmployeeDto): Promise<Employee> {
    const tenantId = this.getTenantId();

    let user: User | null = null; // ✅ استخدام null لأن findOneBy ترجع null
    if (dto.userId) {
      user = await this.userRepo.findOneBy({
        id: dto.userId,
        tenantId: tenantId,
      });
      if (!user) {
        throw new NotFoundException(
          'المستخدم المحدد غير موجود أو لا ينتمي لشركتك',
        );
      }
    }

    const employee = this.repo.create({
      ...dto,
      user: user ?? undefined, // ✅ تحويل null إلى undefined ليتوافق مع Entity
      tenantId: tenantId,
    });

    return await this.repo.save(employee);
  }

  async findAll(): Promise<Employee[]> {
    const tenantId = this.getTenantId();

    return this.repo.find({
      where: { tenantId },
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Employee> {
    const tenantId = this.getTenantId();

    const employee = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['user'],
    });

    if (!employee) throw new NotFoundException('الموظف غير موجود');
    return employee;
  }

  async update(id: string, dto: UpdateEmployeeDto): Promise<Employee> {
    const tenantId = this.getTenantId();
    const employee = await this.findOne(id);

    if (dto.userId && dto.userId !== employee.user?.id) {
      const user = await this.userRepo.findOneBy({
        id: dto.userId,
        tenantId: tenantId,
      });

      if (!user) throw new NotFoundException('المستخدم المحدد غير موجود');
      employee.user = user ?? undefined; // ✅ تحويل آمن
    }

    Object.assign(employee, dto);
    return await this.repo.save(employee);
  }

  async remove(id: string): Promise<void> {
    const employee = await this.findOne(id);
    await this.repo.softRemove(employee);
  }
}
