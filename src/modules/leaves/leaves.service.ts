// src/modules/leaves/leaves.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  Between,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
} from 'typeorm'; // ✅ استيراد أدوات البحث عن التداخل
import {
  LeaveRequest,
  LeaveStatus,
  LeaveType,
} from './entities/leave-request.entity';
import { LeaveBalance } from './entities/leave-balance.entity';
import { CreateLeaveDto } from './dto/create-leave.dto';
import { ContractsService } from '../contracts/contracts.service';

@Injectable()
export class LeavesService {
  constructor(
    @InjectRepository(LeaveRequest)
    private readonly repo: Repository<LeaveRequest>,
    @InjectRepository(LeaveBalance)
    private readonly balanceRepo: Repository<LeaveBalance>,
    private readonly contractsService: ContractsService,
  ) {}

  /**
   * دالة مساعدة للتحقق من تداخل التواريخ مع الإجازات الموجودة
   */
  private async checkDateOverlap(
    employeeId: string,
    startDate: Date,
    endDate: Date,
  ) {
    // البحث عن أي إجازة (موافقة أو معلقة) تتداخل زمنياً مع الفترة الجديدة
    const overlappingLeave = await this.repo.findOne({
      where: [
        {
          employeeId,
          status: In([LeaveStatus.APPROVED, LeaveStatus.PENDING]),
          startDate: Between(startDate, endDate),
        },
        {
          employeeId,
          status: In([LeaveStatus.APPROVED, LeaveStatus.PENDING]),
          endDate: Between(startDate, endDate),
        },
        {
          employeeId,
          status: In([LeaveStatus.APPROVED, LeaveStatus.PENDING]),
          startDate: LessThanOrEqual(startDate),
          endDate: MoreThanOrEqual(endDate),
        },
      ],
    });

    if (overlappingLeave) {
      const statusText =
        overlappingLeave.status === LeaveStatus.APPROVED
          ? 'موافقة'
          : 'معلقة بانتظار الموافقة';
      const start = new Date(overlappingLeave.startDate)
        .toISOString()
        .split('T')[0];
      const end = new Date(overlappingLeave.endDate)
        .toISOString()
        .split('T')[0];
      throw new BadRequestException(
        `لا يمكن تقديم الطلب: يوجد تداخل في التواريخ مع إجازة ${statusText} (${start} إلى ${end})`,
      );
    }
  }

  async create(dto: CreateLeaveDto, employeeId: string, tenantId: string) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);

    if (end < start) {
      throw new BadRequestException(
        'تاريخ النهاية يجب أن يكون بعد تاريخ البداية',
      );
    }

    // ✅ 1. التحقق من تداخل التواريخ أولاً قبل أي عملية أخرى
    await this.checkDateOverlap(employeeId, start, end);

    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    // التحقق من الرصيد فقط إذا كانت الإجازة سنوية
    if (dto.type === LeaveType.ANNUAL) {
      const year = start.getFullYear();

      // محاولة جلب الرصيد الحالي
      let balance = await this.balanceRepo.findOne({
        where: { employeeId, year },
      });

      // ✅ إذا لم يوجد رصيد، نقوم بإنشائه تلقائياً بناءً على العقد
      if (!balance) {
        const contract = await this.contractsService.getByEmployeeId(
          employeeId,
          tenantId,
        );

        if (!contract) {
          throw new BadRequestException(
            'لا يمكن طلب إجازة سنوية: لا يوجد عقد نشط لهذا الموظف',
          );
        }

        // إنشاء رصيد جديد بقيمة أيام الإجازة في العقد
        balance = await this.setBalance(
          { employeeId, year, amount: contract.annualLeaveDays },
          tenantId,
        );
      }

      const remaining = balance.totalAllowance - balance.consumedDays;
      if (remaining < diffDays) {
        throw new BadRequestException(
          `رصيد الإجازات السنوية غير كافٍ. المتبقي: ${remaining} يوم، المطلوب: ${diffDays} يوم`,
        );
      }
    }

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

    if (
      status === LeaveStatus.APPROVED &&
      leave.status !== LeaveStatus.APPROVED &&
      leave.type === LeaveType.ANNUAL
    ) {
      await this.deductBalance(leave);
    }

    leave.status = status;
    return await this.repo.save(leave);
  }

  // ✅ تعديل دالة تعيين الرصيد لتكون عامة وقابلة للاستخدام داخلياً
  async setBalance(
    dto: { employeeId: string; year: number; amount: number },
    tenantId: string,
  ) {
    const existing = await this.balanceRepo.findOne({
      where: { employeeId: dto.employeeId, year: dto.year, tenantId },
    });

    if (existing) {
      existing.totalAllowance = dto.amount;
      return await this.balanceRepo.save(existing);
    }

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
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    const year = start.getFullYear();
    const balance = await this.balanceRepo.findOne({
      where: { employeeId: leave.employeeId, year },
    });

    if (!balance) {
      throw new BadRequestException('خطأ في نظام الرصيد: السجل غير موجود');
    }

    const remaining = balance.totalAllowance - balance.consumedDays;
    if (remaining < diffDays) {
      throw new BadRequestException(
        `رصيد الإجازات غير كافٍ أثناء المعالجة. المتبقي: ${remaining} يوم`,
      );
    }

    balance.consumedDays += diffDays;
    await this.balanceRepo.save(balance);
  }
}
