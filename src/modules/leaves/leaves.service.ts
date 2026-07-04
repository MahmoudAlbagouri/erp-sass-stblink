import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  LeaveRequest,
  LeaveStatus,
  LeaveType,
} from './entities/leave-request.entity';
import { LeaveBalance } from './entities/leave-balance.entity';
import {
  LeaveBalanceHistory,
  LeaveBalanceAction,
} from './entities/leave-balance-history.entity';
import { CreateLeaveDto } from './dto/create-leave.dto';
import { ContractsService } from '../contracts/contracts.service';
import { LeaveAccrualService } from './leave-accrual.service';
import { DateUtils } from '../../common/utils/date.utils';

@Injectable()
export class LeavesService {
  constructor(
    @InjectRepository(LeaveRequest)
    private readonly repo: Repository<LeaveRequest>,
    @InjectRepository(LeaveBalance)
    private readonly balanceRepo: Repository<LeaveBalance>,
    @InjectRepository(LeaveBalanceHistory)
    private readonly historyRepo: Repository<LeaveBalanceHistory>,
    private readonly contractsService: ContractsService,
    private readonly accrualService: LeaveAccrualService,
    private readonly dateUtils: DateUtils,
  ) {}

  /**
   * تفاصيل الرصيد الديناميكي للعرض في الفرونت إند — تتضمن الآن أيضاً
   * الحد الأقصى المسموح به لطلب إجازة (الرصيد + الهامش الائتماني).
   */
  async getAccrualDetails(employeeId: string, tenantId: string) {
    const contract = await this.contractsService.getByEmployeeId(
      employeeId,
      tenantId,
    );
    if (!contract) throw new NotFoundException('لا يوجد عقد نشط لهذا الموظف');

    const year = new Date().getFullYear();
    const balance = await this.getOrCreateCurrentBalance(
      employeeId,
      tenantId,
      year,
    );
    const accrualStartDate = balance.accrualStartDate ?? contract.startDate;

    // ✅ تمرير consumedDays لضمان عرض الرصيد الصحيح بعد التسويات
    const accrual = await this.accrualService.calculateAccrual({
      employeeId,
      tenantId,
      accrualStartDate,
      asOfDate: new Date(),
      annualLeaveDays: balance.totalAllowance,
      carriedOverDays: balance.carriedOverDays,
      consumedDaysFromBalance: balance.consumedDays,
    });

    const allowedRequestLimit = this.accrualService.getAllowedRequestLimit(
      accrual,
      balance.totalAllowance,
    );

    return { ...accrual, allowedRequestLimit };
  }

  /**
   * ✅ محسّنة: تستخدم QueryBuilder بدل repo.find() مع where متعدد الأشكال،
   * ما يقلل الحمل على قاعدة البيانات ويستفيد من الفهارس على employeeId/status.
   */
  private async checkDateOverlap(
    employeeId: string,
    startDate: Date,
    endDate: Date,
  ) {
    const overlapping = await this.repo
      .createQueryBuilder('l')
      .where('l.employeeId = :employeeId', { employeeId })
      .andWhere('l.status IN (:...statuses)', {
        statuses: [LeaveStatus.APPROVED, LeaveStatus.PENDING],
      })
      .andWhere('l.startDate <= :endDate', { endDate })
      .andWhere('l.endDate >= :startDate', { startDate })
      .getOne();

    if (overlapping) {
      const statusText =
        overlapping.status === LeaveStatus.APPROVED
          ? 'موافقة'
          : 'معلقة بانتظار الموافقة';
      const start = new Date(overlapping.startDate).toISOString().split('T')[0];
      const end = new Date(overlapping.endDate).toISOString().split('T')[0];
      throw new BadRequestException(
        `لا يمكن تقديم الطلب: يوجد تداخل في التواريخ مع إجازة ${statusText} (${start} إلى ${end})`,
      );
    }
  }

  /** يجلب سجل الرصيد الحالي، أو يُنشئه تلقائياً بناءً على العقد */
  private async getOrCreateCurrentBalance(
    employeeId: string,
    tenantId: string,
    year: number,
  ): Promise<LeaveBalance> {
    const existing = await this.balanceRepo.findOne({
      where: { employeeId, tenantId, year },
    });
    if (existing) return existing;

    const contract = await this.contractsService.getByEmployeeId(
      employeeId,
      tenantId,
    );

    if (!contract) {
      throw new BadRequestException(
        'لا يمكن إنشاء رصيد إجازات: لا يوجد عقد نشط لهذا الموظف',
      );
    }

    const balance = this.balanceRepo.create({
      employeeId,
      tenantId,
      year,
      totalAllowance: contract.annualLeaveDays,
      consumedDays: 0,
      carriedOverDays: 0,
      accrualStartDate: contract.startDate,
    });

    return await this.balanceRepo.save(balance);
  }

  async create(dto: CreateLeaveDto, employeeId: string, tenantId: string) {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);

    if (end < start) {
      throw new BadRequestException(
        'تاريخ النهاية يجب أن يكون بعد تاريخ البداية',
      );
    }

    await this.checkDateOverlap(employeeId, start, end);

    const diffDays = this.dateUtils.calculateDurationDays(start, end, true);

    if (dto.type === LeaveType.ANNUAL) {
      const year = start.getFullYear();
      const balance = await this.getOrCreateCurrentBalance(
        employeeId,
        tenantId,
        year,
      );

      const accrualStartDate = balance.accrualStartDate ?? start;

      // ✅ تمرير consumedDays للتحقق من الرصيد المتاح الحقيقي (بعد خصم التسويات)
      const accrual = await this.accrualService.calculateAccrual({
        employeeId,
        tenantId,
        accrualStartDate,
        asOfDate: start,
        annualLeaveDays: balance.totalAllowance,
        carriedOverDays: balance.carriedOverDays,
        consumedDaysFromBalance: balance.consumedDays,
      });

      // ✅ سياسة الحد الائتماني القابل للإعداد
      const allowedLimit = this.accrualService.getAllowedRequestLimit(
        accrual,
        balance.totalAllowance,
      );

      if (allowedLimit.lessThan(diffDays)) {
        throw new BadRequestException(
          `رصيد الإجازات غير كافٍ. الرصيد المكتسب فعلياً: ${accrual.availableDays.toFixed(
            2,
          )} يوم، الحد الأقصى المسموح به شاملاً الهامش الائتماني: ${allowedLimit.toFixed(
            2,
          )} يوم، المطلوب: ${diffDays} يوم`,
        );
      }
    }

    const leave = this.repo.create({
      ...dto,
      startDate: start,
      endDate: end,
      employeeId,
      tenantId,
      status: LeaveStatus.PENDING,
    });

    return await this.repo.save(leave);
  }

  async findAll(tenantId: string) {
    return await this.repo.find({
      where: { tenantId },
      relations: { employee: true },
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
      await this.deductBalance(leave, tenantId);
    }

    leave.status = status;
    return await this.repo.save(leave);
  }

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

    const contract = await this.contractsService.getByEmployeeId(
      dto.employeeId,
      tenantId,
    );

    const balance = this.balanceRepo.create({
      employeeId: dto.employeeId,
      year: dto.year,
      totalAllowance: dto.amount,
      tenantId,
      accrualStartDate: contract?.startDate ?? new Date(),
    });
    return await this.balanceRepo.save(balance);
  }

  /** يخصم الرصيد ويسجّل الحركة في سجل التدقيق */
  private async deductBalance(leave: LeaveRequest, tenantId: string) {
    const diffDays = this.dateUtils.calculateDurationDays(
      leave.startDate,
      leave.endDate,
      true,
    );

    const year = new Date(leave.startDate).getFullYear();
    const balance = await this.balanceRepo.findOne({
      where: { employeeId: leave.employeeId, tenantId, year },
    });

    if (!balance) {
      throw new BadRequestException('خطأ في نظام الرصيد: السجل غير موجود');
    }

    const accrualStartDate = balance.accrualStartDate ?? leave.startDate;

    // ✅ تمرير consumedDays لحساب الرصيد المتبقي بدقة قبل وبعد الخصم
    const accrual = await this.accrualService.calculateAccrual({
      employeeId: leave.employeeId,
      tenantId,
      accrualStartDate,
      asOfDate: leave.startDate,
      annualLeaveDays: balance.totalAllowance,
      carriedOverDays: balance.carriedOverDays,
      consumedDaysFromBalance: balance.consumedDays,
    });

    // ملاحظة: التحقق من كفاية الرصيد يحدث في create() عند تقديم الطلب
    // (عبر سياسة الحد الائتماني). هنا نخصم فعلياً عند الموافقة.
    balance.consumedDays += diffDays;
    await this.balanceRepo.save(balance);

    const finalAvailable = accrual.availableDays.minus(diffDays);

    const formattedStartDate = new Date(leave.startDate)
      .toISOString()
      .split('T')[0];
    const formattedEndDate = new Date(leave.endDate)
      .toISOString()
      .split('T')[0];

    await this.historyRepo.save(
      this.historyRepo.create({
        employeeId: leave.employeeId,
        tenantId,
        action: LeaveBalanceAction.CONSUMPTION,
        daysChange: -diffDays,
        balanceAfter: parseFloat(finalAvailable.toFixed(3)),
        referenceId: leave.id,
        cycleYear: year,
        notes: `خصم إجازة سنوية من ${formattedStartDate} إلى ${formattedEndDate}`,
      }),
    );
  }
}
