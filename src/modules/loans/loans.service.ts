// src/modules/loans/loans.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Loan, LoanStatus } from './entities/loan.entity';
import { CreateLoanDto } from './dto/create-loan.dto';

@Injectable()
export class LoansService {
  constructor(@InjectRepository(Loan) private repo: Repository<Loan>) {}

  async create(dto: CreateLoanDto, employeeId: string, tenantId: string) {
    const monthlyInstallment = dto.totalAmount / dto.installmentsCount;
    const loan = this.repo.create({
      ...dto,
      employeeId,
      tenantId,
      monthlyInstallment,
    });
    return await this.repo.save(loan);
  }

  async findAll(tenantId: string) {
    return await this.repo.find({
      where: { tenantId },
      relations: ['employee'],
    });
  }

  async updateStatus(id: string, status: LoanStatus, tenantId: string) {
    const loan = await this.repo.findOne({ where: { id, tenantId } });
    if (!loan) throw new NotFoundException('القرض غير موجود');
    loan.status = status;
    return await this.repo.save(loan);
  }
}
