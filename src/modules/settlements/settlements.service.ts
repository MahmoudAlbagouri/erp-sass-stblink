import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { restrictToScopedBranches } from '../branches/branch-scope';
import Decimal from 'decimal.js';
import { moneyDecimalsOf, roundMoney } from '../../common/utils/money.util';
import { Settlement } from './entities/settlement.entity';
import {
  ConfirmSettlementDto,
  SettlementType,
} from './dto/confirm-settlement.dto';
import { LeaveBalance } from '../leaves/entities/leave-balance.entity';
import {
  LeaveBalanceHistory,
  LeaveBalanceAction,
} from '../leaves/entities/leave-balance-history.entity';
import { SalariesService } from '../salaries/salaries.service';
import { ContractsService } from '../contracts/contracts.service';
import { LeaveAccrualService } from '../leaves/leave-accrual.service';
import { DateUtils } from '../../common/utils/date.utils';
import type { CurrentUserData } from '../../common/decorators/current-user.decorator';
import { isPaidViaDisbursedPayroll } from '../payroll/utils/disbursed-payroll.util';

export interface SettlementPreview {
  employeeId: string;
  year: number;
  serviceDays: number;
  availableDays: number;
  dailyRate: number;
  totalAmountIfFull: number;
}

@Injectable()
export class SettlementsService {
  constructor(
    @InjectRepository(Settlement)
    private readonly repo: Repository<Settlement>,
    @InjectRepository(LeaveBalance)
    private readonly balanceRepo: Repository<LeaveBalance>,
    private readonly salariesService: SalariesService,
    private readonly contractsService: ContractsService,
    private readonly accrualService: LeaveAccrualService,
    private readonly dateUtils: DateUtils,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  private async resolveContractAndBalance(
    employeeId: string,
    tenantId: string,
    year: number,
  ) {
    const [contract, existingBalance] = await Promise.all([
      this.contractsService.getByEmployeeId(employeeId, tenantId),
      this.balanceRepo.findOne({ where: { employeeId, tenantId, year } }),
    ]);

    if (!contract) throw new NotFoundException('لا يوجد عقد نشط لهذا الموظف');

    const balance =
      existingBalance ??
      this.balanceRepo.create({
        employeeId,
        tenantId,
        year,
        totalAllowance: contract.annualLeaveDays,
        consumedDays: 0,
        carriedOverDays: 0,
        accrualStartDate: contract.startDate,
      });

    return { contract, balance };
  }

  async calculateSettlement(
    employeeId: string,
    tenantId: string,
    settlementDate: Date = new Date(),
  ): Promise<SettlementPreview> {
    const currentYear = settlementDate.getFullYear();

    const [{ contract, balance }, salary] = await Promise.all([
      this.resolveContractAndBalance(employeeId, tenantId, currentYear),
      this.salariesService.findByEmployee(employeeId, tenantId),
    ]);

    if (!salary)
      throw new NotFoundException('لم يُعثر على راتب مسجّل لهذا الموظف');

    const effectiveStartDate = balance.accrualStartDate || contract.startDate;

    const accrual = await this.accrualService.calculateAccrual({
      employeeId,
      tenantId,
      accrualStartDate: effectiveStartDate,
      asOfDate: settlementDate,
      annualLeaveDays: balance.totalAllowance,
      carriedOverDays: balance.carriedOverDays,
      consumedDaysFromBalance: balance.consumedDays,
    });

    const dailyRate = new Decimal(salary.totalSalary).dividedBy(30);
    const availableDays = Decimal.max(accrual.availableDays, 0);
    const decimals = await moneyDecimalsOf(this.dataSource.manager, tenantId);

    return {
      employeeId,
      year: currentYear,
      serviceDays: this.dateUtils.calculateDurationDays(
        effectiveStartDate,
        settlementDate,
        false,
      ),
      availableDays: parseFloat(availableDays.toFixed(3)),
      dailyRate: roundMoney(dailyRate, decimals),
      totalAmountIfFull: roundMoney(
        dailyRate.times(Math.ceil(availableDays.toNumber())),
        decimals,
      ),
    };
  }

  async confirmSettlement(
    dto: ConfirmSettlementDto,
    tenantId: string,
  ): Promise<Settlement> {
    const settlementDate = new Date(dto.settlementDate);
    const settlementYear = settlementDate.getFullYear();

    const duplicate = await this.repo.findOne({
      where: { employeeId: dto.employeeId, tenantId, settlementDate },
    });
    if (duplicate)
      throw new BadRequestException('يوجد تسوية مسجّلة بالفعل بنفس التاريخ.');

    const [contract, salary] = await Promise.all([
      this.contractsService.getByEmployeeId(dto.employeeId, tenantId),
      this.salariesService.findByEmployee(dto.employeeId, tenantId),
    ]);
    if (!contract) throw new NotFoundException('لا يوجد عقد نشط لهذا الموظف');
    if (!salary)
      throw new NotFoundException('لم يُعثر على راتب مسجّل لهذا الموظف');

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      let balance = await queryRunner.manager.findOne(LeaveBalance, {
        where: { employeeId: dto.employeeId, tenantId, year: settlementYear },
        lock: { mode: 'pessimistic_write' },
      });

      if (!balance) {
        balance = queryRunner.manager.create(LeaveBalance, {
          employeeId: dto.employeeId,
          tenantId,
          year: settlementYear,
          totalAllowance: contract.annualLeaveDays,
          consumedDays: 0,
          carriedOverDays: 0,
          accrualStartDate: contract.startDate,
        });
      }

      const effectiveStartDate = balance.accrualStartDate || contract.startDate;

      const accrual = await this.accrualService.calculateAccrual({
        employeeId: dto.employeeId,
        tenantId,
        accrualStartDate: effectiveStartDate,
        asOfDate: settlementDate,
        annualLeaveDays: balance.totalAllowance,
        carriedOverDays: balance.carriedOverDays,
        consumedDaysFromBalance: balance.consumedDays,
      });

      const availableDays = Decimal.max(accrual.availableDays, 0);
      const dailyRate = new Decimal(salary.totalSalary).dividedBy(30);

      let daysToDeduct: Decimal;
      if (dto.settlementType === SettlementType.FULL) {
        daysToDeduct = availableDays;
      } else {
        const requested = new Decimal(dto.daysToSettle ?? 0);
        if (requested.lessThanOrEqualTo(0)) {
          throw new BadRequestException(
            'يجب تحديد عدد أيام صحيح وأكبر من صفر للتسوية الجزئية',
          );
        }
        if (requested.greaterThan(availableDays)) {
          throw new BadRequestException(
            `عدد الأيام المطلوب صرفها (${requested.toFixed(2)}) يتجاوز الرصيد المتاح (${availableDays.toFixed(2)} يوم)`,
          );
        }
        daysToDeduct = requested;
      }

      const roundedDays = Math.ceil(daysToDeduct.toNumber());
      const decimals = await moneyDecimalsOf(queryRunner.manager, tenantId);
      const totalAmount = roundMoney(dailyRate.times(roundedDays), decimals);

      balance.consumedDays += roundedDays;

      if (dto.settlementType === SettlementType.FULL) {
        balance.accrualStartDate = settlementDate;
        balance.carriedOverDays = 0;
      }

      await queryRunner.manager.save(LeaveBalance, balance);

      const settlement = queryRunner.manager.create(Settlement, {
        employeeId: dto.employeeId,
        tenantId,
        settlementDate,
        unusedLeaveDays: roundedDays,
        dailyRate: roundMoney(dailyRate, decimals),
        totalAmount,
        notes:
          dto.notes ??
          (dto.settlementType === SettlementType.FULL
            ? 'تسوية كاملة بدل الاجازة'
            : `تسوية جزئية (${roundedDays} يوم)`),
        // ✅ الصرف يكون افتراضياً غير مفعل عند الإنشاء
        isDisbursed: false,
      });
      const saved = await queryRunner.manager.save(Settlement, settlement);

      const remainingAfter = Decimal.max(availableDays.minus(daysToDeduct), 0);

      await queryRunner.manager.save(LeaveBalanceHistory, {
        employeeId: dto.employeeId,
        tenantId,
        action: LeaveBalanceAction.SETTLEMENT,
        daysChange: -roundedDays,
        balanceAfter: parseFloat(remainingAfter.toFixed(3)),
        referenceId: saved.id,
        cycleYear: settlementYear,
        notes: `تسوية ${
          dto.settlementType === SettlementType.FULL ? 'كاملة' : 'جزئية'
        } بتاريخ ${dto.settlementDate} — ${roundedDays} يوم بقيمة ${totalAmount}`,
      });

      await queryRunner.commitTransaction();
      return saved;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // ✅ دالة جديدة لتأكيد الصرف
  async disburseSettlement(
    settlementId: string,
    tenantId: string,
    user: CurrentUserData,
  ): Promise<Settlement> {
    const settlement = await this.repo.findOne({
      where: { id: settlementId, tenantId },
    });

    if (!settlement) throw new NotFoundException('التسوية غير موجودة');
    if (settlement.isDisbursed) {
      throw new BadRequestException('هذه التسوية مصروفة مسبقاً');
    }

    // ✅ منع الصرف الاستثنائي لتسوية سبق ودخلت ضمن مسير رواتب تم صرفه
    // بالفعل — عندها تكون قد صُرفت ماليًا مسبقاً عبر المسير نفسه
    const alreadyPaid = await isPaidViaDisbursedPayroll(
      this.dataSource,
      settlement.employeeId,
      tenantId,
      new Date(settlement.settlementDate),
    );
    if (alreadyPaid) {
      throw new BadRequestException(
        'تم صرف هذا المبلغ بالفعل ضمن مسير رواتب مصروف لنفس الشهر — لا يمكن تسجيله كصرف استثنائي مباشر',
      );
    }

    settlement.isDisbursed = true;
    settlement.disbursedById = user.id; // ← كان user.userId
    settlement.disbursedAt = new Date();

    return await this.repo.save(settlement);
  }

  async findAll(tenantId: string): Promise<Settlement[]> {
    const qb = this.repo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.employee', 'employee')
      .leftJoinAndSelect('s.disbursedBy', 'disbursedBy') // ✅ جلب بيانات المستخدم الذي قام بالصرف
      .where('s.tenantId = :tenantId', { tenantId });
    restrictToScopedBranches(qb, 'employee.branchId');

    return qb.orderBy('s.createdAt', 'DESC').getMany();
  }

  async findByEmployee(
    employeeId: string,
    tenantId: string,
  ): Promise<Settlement | null> {
    return await this.repo.findOne({
      where: { employeeId, tenantId },
      relations: { employee: true, disbursedBy: true },
      order: { createdAt: 'DESC' },
    });
  }
}
