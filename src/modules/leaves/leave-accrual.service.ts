import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Decimal from 'decimal.js';
import {
  LeaveRequest,
  LeaveStatus,
  LeaveType,
} from './entities/leave-request.entity';
import { DateUtils } from '../../common/utils/date.utils';
import { LeavePolicyService } from './config/leave-policy.config';

export interface AccrualParams {
  employeeId: string;
  tenantId: string;
  accrualStartDate: Date | string;
  asOfDate: Date | string;
  annualLeaveDays: number;
  carriedOverDays?: number;
  consumedDaysFromBalance?: number; // ✅ إضافة جديدة لحساب التسويات
}

export interface AccrualResult {
  serviceDays: number;
  unpaidDays: number;
  netServiceDays: number;
  dailyAccrualRate: Decimal;
  earnedDays: Decimal;
  consumedAnnualDays: number;
  carriedOverDays: Decimal;
  availableDays: Decimal;
}

@Injectable()
export class LeaveAccrualService {
  constructor(
    @InjectRepository(LeaveRequest)
    private readonly leaveRepo: Repository<LeaveRequest>,
    private readonly dateUtils: DateUtils,
    private readonly policyService: LeavePolicyService,
  ) {}

  dailyAccrualRate(annualLeaveDays: number): Decimal {
    return new Decimal(annualLeaveDays).dividedBy(365);
  }

  /**
   * أيام Unpaid تُقصّ (clip) على asOfDate عن قصد:
   * "مدة الخدمة" مفهوم زمني، فلا معنى لخصم أيام غياب لم تُعَش بعد.
   */
  async getUnpaidDaysInPeriod(
    employeeId: string,
    tenantId: string,
    from: Date | string,
    to: Date | string,
  ): Promise<number> {
    const toDate = to instanceof Date ? to : new Date(to);
    const fromDate = from instanceof Date ? from : new Date(from);

    const leaves = await this.leaveRepo
      .createQueryBuilder('l')
      .select(['l.startDate', 'l.endDate'])
      .where('l.employeeId = :employeeId', { employeeId })
      .andWhere('l.tenantId = :tenantId', { tenantId })
      .andWhere('l.type = :type', { type: LeaveType.UNPAID })
      .andWhere('l.status = :status', { status: LeaveStatus.APPROVED })
      .andWhere('l.startDate <= :toDate', { toDate })
      .andWhere('l.endDate >= :fromDate', { fromDate })
      .getMany();

    return leaves.reduce((total, leave) => {
      return (
        total +
        this.dateUtils.clipDaysToPeriod(
          leave.startDate,
          leave.endDate,
          from,
          to,
        )
      );
    }, 0);
  }

  /**
   * الإجازة السنوية (Annual) هي "استهلاك رصيد" وليست مفهوماً زمنياً،
   * فتُخصم بالكامل فور الموافقة عليها بصرف النظر عن asOfDate.
   */
  async getConsumedAnnualDaysInPeriod(
    employeeId: string,
    tenantId: string,
    accrualStartDate: Date | string,
  ): Promise<number> {
    const fromDate =
      accrualStartDate instanceof Date
        ? accrualStartDate
        : new Date(accrualStartDate);

    const leaves = await this.leaveRepo
      .createQueryBuilder('l')
      .select(['l.startDate', 'l.endDate'])
      .where('l.employeeId = :employeeId', { employeeId })
      .andWhere('l.tenantId = :tenantId', { tenantId })
      .andWhere('l.type = :type', { type: LeaveType.ANNUAL })
      .andWhere('l.status = :status', { status: LeaveStatus.APPROVED })
      .andWhere('l.startDate >= :fromDate', { fromDate })
      .getMany();

    return leaves.reduce((total, leave) => {
      return (
        total +
        this.dateUtils.calculateDurationDays(
          leave.startDate,
          leave.endDate,
          true,
        )
      );
    }, 0);
  }

  async calculateAccrual(params: AccrualParams): Promise<AccrualResult> {
    const {
      employeeId,
      tenantId,
      accrualStartDate,
      asOfDate,
      annualLeaveDays,
      carriedOverDays = 0,
      consumedDaysFromBalance = 0, // ✅ القيمة الافتراضية صفر
    } = params;

    const serviceDays = this.dateUtils.calculateDurationDays(
      accrualStartDate,
      asOfDate,
      false,
    );

    const [unpaidDays, consumedAnnualDays] = await Promise.all([
      this.getUnpaidDaysInPeriod(
        employeeId,
        tenantId,
        accrualStartDate,
        asOfDate,
      ),
      this.getConsumedAnnualDaysInPeriod(
        employeeId,
        tenantId,
        accrualStartDate,
      ),
    ]);

    const netServiceDays = Math.max(serviceDays - unpaidDays, 0);
    const dailyAccrualRate = this.dailyAccrualRate(annualLeaveDays);
    const earnedDays = dailyAccrualRate.times(netServiceDays);
    const carried = new Decimal(carriedOverDays);

    // ✅ طرح أيام التسوية (consumedDays) من الرصيد المتاح
    const availableDays = carried
      .plus(earnedDays)
      .minus(consumedAnnualDays)
      .minus(consumedDaysFromBalance);

    return {
      serviceDays,
      unpaidDays,
      netServiceDays,
      dailyAccrualRate,
      earnedDays,
      consumedAnnualDays,
      carriedOverDays: carried,
      availableDays: Decimal.max(availableDays, 0), // التأكد من عدم وجود رصيد سالب
    };
  }

  /**
   * سياسة "الحد الائتماني القابل للإعداد" (Configurable Credit Limit).
   */
  getAllowedRequestLimit(
    accrual: AccrualResult,
    annualLeaveDays: number,
  ): Decimal {
    const policy = this.policyService.get();

    const extraCredit =
      policy.creditLimitMode === 'FIXED_DAYS'
        ? new Decimal(policy.creditLimitFixedDays)
        : new Decimal(annualLeaveDays).times(policy.creditLimitPercent);

    return Decimal.max(accrual.availableDays.plus(extraCredit), 0);
  }
}
