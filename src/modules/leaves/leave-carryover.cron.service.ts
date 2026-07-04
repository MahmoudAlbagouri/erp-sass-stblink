import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { Contract } from '../contracts/entities/contract.entity';
import { LeaveBalance } from './entities/leave-balance.entity';
import {
  LeaveBalanceHistory,
  LeaveBalanceAction,
} from './entities/leave-balance-history.entity';
import { LeaveAccrualService } from './leave-accrual.service';
import { DateUtils } from '../../common/utils/date.utils';
import { LeavePolicyService } from './config/leave-policy.config';

export interface CarryOverRunResult {
  employeeId: string;
  cyclesProcessed: number[];
  finalCarriedOverDays: number;
}

@Injectable()
export class LeaveCarryoverCronService {
  private readonly logger = new Logger(LeaveCarryoverCronService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly accrualService: LeaveAccrualService,
    private readonly dateUtils: DateUtils,
    private readonly policyService: LeavePolicyService,
  ) {}

  /**
   * تعمل يومياً الساعة 1 صباحاً.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleAnnualCarryOver(): Promise<void> {
    const today = new Date();
    const contractRepo = this.dataSource.getRepository(Contract);

    const contracts = await contractRepo
      .createQueryBuilder('c')
      .where('c.startDate <= :today', { today })
      .getMany();

    this.logger.log(`فحص ترحيل الرصيد لـ ${contracts.length} عقد نشط`);

    let updatedCount = 0;
    for (const contract of contracts) {
      try {
        const result = await this.processContractCarryOver(contract, today);
        if (result.cyclesProcessed.length > 0) updatedCount++;
      } catch (err) {
        this.logger.error(
          `فشل ترحيل الرصيد للموظف ${contract.employeeId}: ${err}`,
        );
      }
    }

    this.logger.log(`اكتمل الفحص — تم تحديث رصيد ${updatedCount} موظف`);
  }

  /**
   * ✅ Endpoint يدوي: إعادة حساب الترحيل لموظف محدد.
   */
  async recalculateForEmployee(
    employeeId: string,
    tenantId: string,
  ): Promise<CarryOverRunResult> {
    const contract = await this.dataSource.getRepository(Contract).findOne({
      where: { employeeId, tenantId },
    });
    if (!contract) {
      throw new NotFoundException('لا يوجد عقد نشط لهذا الموظف');
    }
    return await this.processContractCarryOver(contract, new Date());
  }

  /** ✅ Endpoint يدوي: إعادة حساب الترحيل لجميع الموظفين دفعة واحدة */
  async recalculateAll(): Promise<CarryOverRunResult[]> {
    const contracts = await this.dataSource.getRepository(Contract).find();
    const results: CarryOverRunResult[] = [];

    for (const contract of contracts) {
      try {
        results.push(await this.processContractCarryOver(contract, new Date()));
      } catch (err) {
        this.logger.error(
          `فشل إعادة حساب الترحيل للموظف ${contract.employeeId}: ${err}`,
        );
      }
    }

    return results;
  }

  private async processContractCarryOver(
    contract: Contract,
    asOfDate: Date,
  ): Promise<CarryOverRunResult> {
    const policy = this.policyService.get();

    const contractStartYear = new Date(contract.startDate).getFullYear();
    const currentYear = asOfDate.getFullYear();

    const earliestPossibleYear = contractStartYear + 1;
    const oldestAllowedYear = Math.max(
      earliestPossibleYear,
      currentYear - policy.maxBackfillYears,
    );

    const cyclesProcessed: number[] = [];
    let finalCarried = 0;

    for (let year = oldestAllowedYear; year <= currentYear; year++) {
      const anniversary = this.dateUtils.anniversaryForYear(
        contract.startDate,
        year,
      );
      if (!this.dateUtils.isSameOrBefore(anniversary, asOfDate)) continue;

      const alreadyProcessed = await this.dataSource
        .getRepository(LeaveBalanceHistory)
        .findOne({
          where: {
            employeeId: contract.employeeId,
            tenantId: contract.tenantId,
            action: LeaveBalanceAction.CARRY_OVER,
            cycleYear: year,
          },
        });
      if (alreadyProcessed) continue;

      finalCarried = await this.runCarryOverCycle(contract, year, anniversary);
      cyclesProcessed.push(year);
    }

    if (cyclesProcessed.length > 0) {
      this.logger.log(
        `تم ترحيل ${cyclesProcessed.length} دورة (${cyclesProcessed.join(
          ', ',
        )}) للموظف ${contract.employeeId}`,
      );
    }

    return {
      employeeId: contract.employeeId,
      cyclesProcessed,
      finalCarriedOverDays: finalCarried,
    };
  }

  /** ينفّذ ترحيل دورة سنوية واحدة داخل Transaction */
  private async runCarryOverCycle(
    contract: Contract,
    cycleYear: number,
    anniversary: Date,
  ): Promise<number> {
    const policy = this.policyService.get();
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const balanceRepo = queryRunner.manager.getRepository(LeaveBalance);
      const historyRepo =
        queryRunner.manager.getRepository(LeaveBalanceHistory);

      const previousYear = cycleYear - 1;
      const previousBalance = await balanceRepo.findOne({
        where: {
          employeeId: contract.employeeId,
          tenantId: contract.tenantId,
          year: previousYear,
        },
      });

      const accrualStartDate =
        previousBalance?.accrualStartDate ?? contract.startDate;
      const carriedOverDays = previousBalance?.carriedOverDays ?? 0;

      // ✅ جلب أيام التسوية من السنة السابقة لضمان عدم ترحيل رصيد تم صرفه نقدياً
      const consumedDaysFromBalance = previousBalance?.consumedDays ?? 0;

      const accrual = await this.accrualService.calculateAccrual({
        employeeId: contract.employeeId,
        tenantId: contract.tenantId,
        accrualStartDate,
        asOfDate: anniversary,
        annualLeaveDays: contract.annualLeaveDays,
        carriedOverDays,
        consumedDaysFromBalance, // ✅ تمرير الأيام المستهلكة (تشمل التسويات)
      });

      // لا نُرحّل رصيداً سالباً أبداً، ونُطبّق سقف الترحيل التراكمي الأقصى
      const rawCarry = Decimal.max(accrual.availableDays, 0);
      const cappedCarry = Decimal.min(rawCarry, policy.maxCarryOverDays);

      let newBalance = await balanceRepo.findOne({
        where: {
          employeeId: contract.employeeId,
          tenantId: contract.tenantId,
          year: cycleYear,
        },
      });

      if (!newBalance) {
        newBalance = balanceRepo.create({
          employeeId: contract.employeeId,
          tenantId: contract.tenantId,
          year: cycleYear,
          totalAllowance: contract.annualLeaveDays,
          consumedDays: 0,
        });
      }

      newBalance.carriedOverDays = parseFloat(cappedCarry.toFixed(3));
      newBalance.accrualStartDate = anniversary;
      await balanceRepo.save(newBalance);

      await historyRepo.save(
        historyRepo.create({
          employeeId: contract.employeeId,
          tenantId: contract.tenantId,
          action: LeaveBalanceAction.CARRY_OVER,
          daysChange: parseFloat(cappedCarry.toFixed(3)),
          balanceAfter: parseFloat(cappedCarry.toFixed(3)),
          cycleYear,
          notes: rawCarry.greaterThan(cappedCarry)
            ? `ترحيل رصيد عند ذكرى ${cycleYear} — تم تطبيق السقف الأقصى (${policy.maxCarryOverDays} يوم)، الرصيد الفعلي المكتسب كان ${rawCarry.toFixed(2)} يوم`
            : `ترحيل رصيد عند ذكرى التعيين لسنة ${cycleYear}`,
        }),
      );

      await queryRunner.commitTransaction();
      return cappedCarry.toNumber();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
