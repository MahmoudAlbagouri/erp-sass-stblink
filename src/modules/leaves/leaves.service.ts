import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeaveRequest, LeaveStatus } from './entities/leave-request.entity';
import { LeaveBalance } from './entities/leave-balance.entity';
import { CreateLeaveDto } from './dto/create-leave.dto';

@Injectable()
export class LeavesService {
  constructor(
    @InjectRepository(LeaveRequest)
    private readonly repo: Repository<LeaveRequest>,
    @InjectRepository(LeaveBalance)
    private readonly balanceRepo: Repository<LeaveBalance>,
  ) {}

  async create(dto: CreateLeaveDto, employeeId: string, tenantId: string) {
    // 1. حساب الأيام التقويمية المطلوبة
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    // 2. التحقق من وجود رصيد للموظف في السنة الحالية
    const year = start.getFullYear();
    const balance = await this.balanceRepo.findOne({
      where: { employeeId, year },
    });

    if (!balance) {
      throw new BadRequestException(
        'لا يوجد سجل رصيد إجازات لهذا الموظف للسنة الحالية',
      );
    }

    // 3. التحقق من كفاية الرصيد
    const remaining = balance.totalAllowance - balance.consumedDays;
    if (remaining < diffDays) {
      throw new BadRequestException(
        `لا يمكن تقديم الطلب. رصيدك المتبقي (${remaining} يوم) أقل من عدد الأيام المطلوبة (${diffDays} يوم).`,
      );
    }

    // 4. إذا مر التحقق بنجاح، يتم إنشاء الطلب
    const leave = this.repo.create({
      ...dto,
      employeeId,
      tenantId,
      status: LeaveStatus.PENDING,
    });

    return await this.repo.save(leave);
  }
  async findAll(tenantId: string) {
    return await this.repo.find({
      where: { tenantId },
      relations: ['employee'],
      order: { createdAt: 'DESC' },
    });
  }

  async updateStatus(id: string, status: LeaveStatus, tenantId: string) {
    const leave = await this.repo.findOne({ where: { id, tenantId } });

    if (!leave) {
      throw new NotFoundException('طلب الإجازة غير موجود في مؤسستك');
    }

    // إذا تم تغيير الحالة إلى APPROVED
    if (
      status === LeaveStatus.APPROVED &&
      leave.status !== LeaveStatus.APPROVED
    ) {
      await this.deductBalance(leave);
    }

    leave.status = status;
    return await this.repo.save(leave);
  }
  async setBalance(
    dto: { employeeId: string; year: number; amount: number },
    tenantId: string,
  ) {
    const balance = this.balanceRepo.create({
      employeeId: dto.employeeId,
      year: dto.year,
      totalAllowance: dto.amount,
      tenantId,
    });
    return await this.balanceRepo.save(balance);
  }

  private async deductBalance(leave: LeaveRequest) {
    const start = new Date(leave.startDate);
    const end = new Date(leave.endDate);

    // حساب الأيام التقويمية (Calendar Days)
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    const year = start.getFullYear();
    const balance = await this.balanceRepo.findOne({
      where: { employeeId: leave.employeeId, year },
    });

    if (!balance) {
      throw new BadRequestException(
        'لا يوجد سجل رصيد إجازات لهذا الموظف للسنة الحالية',
      );
    }

    // التحقق من توفر الرصيد
    const remaining = balance.totalAllowance - balance.consumedDays;
    if (remaining < diffDays) {
      throw new BadRequestException(
        `رصيد الإجازات غير كافٍ. المتبقي: ${remaining} يوم، المطلوب: ${diffDays} يوم`,
      );
    }

    // خصم الأيام
    balance.consumedDays += diffDays;
    await this.balanceRepo.save(balance);
  }
}
