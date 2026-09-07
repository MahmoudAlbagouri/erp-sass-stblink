// src/modules/leaves/leaves.service.ts
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

// ✅ شكل بيانات كل طلب إجازة داخل ملخص صفحة الموظف
export interface EmployeeLeaveRequestSummary {
  id: string;
  startDate: Date;
  endDate: Date;
  type: LeaveType;
  status: LeaveStatus;
  days: number; // عدد أيام هذا الطلب تحديداً
  reason?: string;
}

// ✅ الشكل الكامل لملخص إجازات الموظف (يُستخدم في صفحة تفاصيل الموظف)
export interface EmployeeLeaveSummaryResult {
  totalAllowance: number; // السقف السنوي للاستحقاق
  carriedOverDays: number; // المرحّل من سنة سابقة
  earnedDays: number; // المكتسب حتى الآن هذه السنة
  consumedAnnualDays: number; // ✅ عدد أيام الإجازة الفعلي (المستهلك من الإجازات السنوية الموافق عليها)
  availableDays: number; // ✅ عدد الأيام المتبقية له
  allowedRequestLimit: number; // الحد الأقصى المسموح به شاملاً هامش الائتمان
  requests: EmployeeLeaveRequestSummary[]; // ✅ عدد أيام كل إجازة طلبها
}

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

    // ✅ إضافة totalAllowance للنتيجة (كان ناقصاً) — تغيير غير كاسر لأي مستهلك حالي
    return {
      ...accrual,
      allowedRequestLimit,
      totalAllowance: balance.totalAllowance,
    };
  }

  /**
   * ✅ ملخص إجازات الموظف لصفحة "تفاصيل الموظف":
   * - عدد أيام الإجازة الفعلي (المستهلك من رصيد الإجازة السنوية)
   * - عدد أيام كل إجازة طلبها الموظف (لكل الأنواع: سنوية / بدون راتب / أخرى)
   * - عدد الأيام المتبقية له
   */
  async getEmployeeLeaveSummary(
    employeeId: string,
    tenantId: string,
  ): Promise<EmployeeLeaveSummaryResult> {
    const accrual = await this.getAccrualDetails(employeeId, tenantId);

    const leaveRequests = await this.repo.find({
      where: { employeeId, tenantId },
      order: { startDate: 'DESC' },
    });

    const requests: EmployeeLeaveRequestSummary[] = leaveRequests.map((r) => ({
      id: r.id,
      startDate: r.startDate,
      endDate: r.endDate,
      type: r.type,
      status: r.status,
      days: this.dateUtils.calculateDurationDays(
        r.startDate,
        r.endDate,
        true, // شامل يوم البداية والنهاية، كما هو معمول به في باقي حسابات الوحدة
      ),
      reason: r.reason,
    }));

    return {
      totalAllowance: accrual.totalAllowance,
      carriedOverDays: accrual.carriedOverDays.toNumber
        ? accrual.carriedOverDays.toNumber()
        : Number(accrual.carriedOverDays),
      earnedDays: accrual.earnedDays.toNumber
        ? accrual.earnedDays.toNumber()
        : Number(accrual.earnedDays),
      consumedAnnualDays: accrual.consumedAnnualDays,
      availableDays: accrual.availableDays.toNumber
        ? accrual.availableDays.toNumber()
        : Number(accrual.availableDays),
      allowedRequestLimit: accrual.allowedRequestLimit.toNumber
        ? accrual.allowedRequestLimit.toNumber()
        : Number(accrual.allowedRequestLimit),
      requests,
    };
  }

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
    if (!contract)
      throw new BadRequestException(
        'لا يمكن إنشاء رصيد إجازات: لا يوجد عقد نشط لهذا الموظف',
      );

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
    if (end < start)
      throw new BadRequestException(
        'تاريخ النهاية يجب أن يكون بعد تاريخ البداية',
      );

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

      const accrual = await this.accrualService.calculateAccrual({
        employeeId,
        tenantId,
        accrualStartDate,
        asOfDate: start,
        annualLeaveDays: balance.totalAllowance,
        carriedOverDays: balance.carriedOverDays,
        consumedDaysFromBalance: balance.consumedDays,
      });

      const allowedLimit = this.accrualService.getAllowedRequestLimit(
        accrual,
        balance.totalAllowance,
      );
      if (allowedLimit.lessThan(diffDays)) {
        throw new BadRequestException(
          `رصيد الإجازات غير كافٍ. الرصيد المكتسب فعلياً: ${accrual.availableDays.toFixed(2)} يوم، الحد الأقصى المسموح به شاملاً الهامش الائتماني: ${allowedLimit.toFixed(2)} يوم، المطلوب: ${diffDays} يوم`,
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

  // ✅ تحديث findAll لجلب بيانات الموظف
  async findAll(tenantId: string) {
    return await this.repo.find({
      where: { tenantId },
      relations: ['employee'],
      order: { createdAt: 'DESC' },
    });
  }

  // ✅ إضافة findOne المفقودة للتصدير الفردي
  async findOne(id: string, tenantId: string) {
    const leave = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['employee'],
    });
    if (!leave) throw new NotFoundException('طلب الإجازة غير موجود');
    return leave;
  }

  async updateStatus(id: string, status: LeaveStatus, tenantId: string) {
    const leave = await this.repo.findOne({ where: { id, tenantId } });
    if (!leave) throw new NotFoundException('طلب الإجازة غير موجود في مؤسستك');

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
    if (!balance)
      throw new BadRequestException('خطأ في نظام الرصيد: السجل غير موجود');

    const accrualStartDate = balance.accrualStartDate ?? leave.startDate;
    const accrual = await this.accrualService.calculateAccrual({
      employeeId: leave.employeeId,
      tenantId,
      accrualStartDate,
      asOfDate: leave.startDate,
      annualLeaveDays: balance.totalAllowance,
      carriedOverDays: balance.carriedOverDays,
      consumedDaysFromBalance: balance.consumedDays,
    });

    // ✅ تم حذف: balance.consumedDays += diffDays; await this.balanceRepo.save(balance);
    // السبب: consumedAnnualDays في calculateAccrual بيحسب الإجازات الموافق عليها
    // مباشرة من جدول leave_requests، فزيادة consumedDays هنا كانت بتسبب خصم مزدوج.
    // balance.consumedDays الآن مخصص فقط لاستهلاك خارج نطاق leave_requests
    // (زي التسويات في settlements.service.ts).

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
