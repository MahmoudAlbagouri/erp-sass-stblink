import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { assertStatusTransition } from '../../common/utils/status-transition.util';
import { scopedEmployeeWhere } from '../branches/branch-scope';
import { Loan, LoanStatus } from './entities/loan.entity';
import { CreateLoanDto } from './dto/create-loan.dto';

const LOAN_STATUS_LABEL: Record<LoanStatus, string> = {
  [LoanStatus.PENDING]: 'معلّق',
  [LoanStatus.APPROVED]: 'معتمد',
  [LoanStatus.REJECTED]: 'مرفوض',
  [LoanStatus.COMPLETED]: 'مكتمل',
};

@Injectable()
export class LoansService {
  constructor(@InjectRepository(Loan) private repo: Repository<Loan>) {}

  async create(dto: CreateLoanDto, employeeId: string, tenantId: string) {
    const monthlyInstallment =
      Number(dto.totalAmount) / Number(dto.installmentsCount);

    const loan = this.repo.create({
      ...dto,
      employeeId,
      tenantId,
      monthlyInstallment,
      startDate: new Date(dto.startDate),
      paidInstallments: 0, // تهيئة القيمة افتراضياً
    });

    return await this.repo.save(loan);
  }

  async findAll(tenantId: string) {
    return await this.repo.find({
      where: { tenantId, ...scopedEmployeeWhere() },
      relations: ['employee'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, tenantId: string) {
    const loan = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['employee'],
    });
    if (!loan) throw new NotFoundException('القرض غير موجود');
    return loan;
  }

  /**
   * اعتماد أو رفض قرض معلّق فقط. "مكتمل" يضعه المسير عند آخر قسط. وقت
   * الاعتماد يُحفظ: به يُقيَّد تسليم مبلغ القرض في المحاسبة.
   */
  async updateStatus(id: string, status: LoanStatus, tenantId: string) {
    const loan = await this.repo.findOne({ where: { id, tenantId } });
    if (!loan) throw new NotFoundException('القرض غير موجود');
    assertStatusTransition(
      loan.status,
      status,
      { [LoanStatus.PENDING]: [LoanStatus.APPROVED, LoanStatus.REJECTED] },
      LOAN_STATUS_LABEL,
    );

    loan.status = status;
    if (status === LoanStatus.APPROVED) loan.approvedAt = new Date();
    return await this.repo.save(loan);
  }
}
