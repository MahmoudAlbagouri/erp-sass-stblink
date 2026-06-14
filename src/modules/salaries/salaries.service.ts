// src/modules/salaries/salaries.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Salary } from './entities/salary.entity';
import { CreateSalaryDto } from './dto/create-salary.dto';
import { UpdateSalaryDto } from './dto/update-salary.dto';

@Injectable()
export class SalariesService {
  constructor(@InjectRepository(Salary) private repo: Repository<Salary>) {}

  // نستخدم النوع الصحيح بدلاً من any
  private calculateTotal(data: CreateSalaryDto | UpdateSalaryDto): number {
    return (
      Number(data.basicSalary || 0) +
      Number(data.housingAllowance || 0) +
      Number(data.transportAllowance || 0) +
      Number(data.otherAllowances || 0)
    );
  }

  async create(dto: CreateSalaryDto, tenantId: string) {
    const totalSalary = this.calculateTotal(dto);
    const salary = this.repo.create({ ...dto, tenantId, totalSalary });
    return await this.repo.save(salary);
  }

  async findAll(tenantId: string) {
    return await this.repo.find({ where: { tenantId } });
  }

  async update(id: string, dto: UpdateSalaryDto, tenantId: string) {
    const salary = await this.repo.findOne({ where: { id, tenantId } });
    if (!salary) throw new NotFoundException('الراتب غير موجود');

    Object.assign(salary, dto);
    salary.totalSalary = this.calculateTotal(salary);
    return await this.repo.save(salary);
  }
}
