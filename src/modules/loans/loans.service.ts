import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { assertStatusTransition } from '../../common/utils/status-transition.util';
import { scopedEmployeeWhere } from '../branches/branch-scope';
import { Loan, LoanStatus } from './entities/loan.entity';
import { CreateLoanDto } from './dto/create-loan.dto';
import { DomainEvents } from '../../common/events/domain-events';

const LOAN_STATUS_LABEL: Record<LoanStatus, string> = {
  [LoanStatus.PENDING]: 'معلّق',
  [LoanStatus.APPROVED]: 'معتمد',
  [LoanStatus.REJECTED]: 'مرفوض',
  [LoanStatus.COMPLETED]: 'مكتمل',
};

@Injectable()
export class LoansService {
  constructor(
    @InjectRepository(Loan) private repo: Repository<Loan>,
    private readonly events: DomainEvents,
  ) {}

  async create(
    dto: CreateLoanDto,
    employeeId: string,
    tenantId: string,
    actorUserId?: string,
  ) {
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

    const saved = await this.repo.save(loan);
    this.events.emit('loan.requested', {
      tenantId,
      actorUserId,
      loanId: saved.id,
      employeeId,
      amount: Number(dto.totalAmount),
      installments: Number(dto.installmentsCount),
    });
    return saved;
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
  async updateStatus(
    id: string,
    status: LoanStatus,
    tenantId: string,
    actorUserId?: string,
  ) {
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
    const saved = await this.repo.save(loan);
    this.events.emit('loan.decided', {
      tenantId,
      actorUserId,
      loanId: saved.id,
      employeeId: saved.employeeId,
      status,
      amount: Number(saved.totalAmount),
      monthlyInstallment: Number(saved.monthlyInstallment),
    });
    return saved;
  }
}
