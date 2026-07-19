import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import Decimal from 'decimal.js';
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
    @InjectRepository(LeaveBalanceHistory)
    private readonly historyRepo: Repository<LeaveBalanceHistory>,
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

    // ✅ تمرير consumedDays لضمان عرض الرصيد الصحيح في المعاينة
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

    return {
      employeeId,
      year: currentYear,
      serviceDays: this.dateUtils.calculateDurationDays(
        effectiveStartDate,
        settlementDate,
        false,
      ),
      availableDays: parseFloat(availableDays.toFixed(3)),
      dailyRate: parseFloat(dailyRate.toFixed(2)),
      totalAmountIfFull: parseFloat(
        dailyRate.times(Math.ceil(availableDays.toNumber())).toFixed(2),
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

      // ✅ إعادة حساب الاستحقاق لحظة التأكيد مع مراعاة التسويات السابقة
      const accrual = await this.accrualService.calculateAccrual({
        employeeId: dto.employeeId,
        tenantId,
        accrualStartDate: effectiveStartDate,
        asOfDate: settlementDate,
        annualLeaveDays: balance.totalAllowance,
        carriedOverDays: balance.carriedOverDays,
        consumedDaysFromBalance: balance.consumedDays, // ✅ هذا هو التعديل الجوهري
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
      const totalAmount = dailyRate.times(roundedDays);

      // ✅ زيادة عداد الاستهلاك ليتم خصمه في العمليات المستقبلية
      balance.consumedDays += roundedDays;

      // تحديث تاريخ بدء الاستحقاق فقط في حالة التسوية الكاملة (نهاية الخدمة)
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
        dailyRate: parseFloat(dailyRate.toFixed(2)),
        totalAmount: parseFloat(totalAmount.toFixed(2)),
        notes:
          dto.notes ??
          (dto.settlementType === SettlementType.FULL
            ? 'تسوية كاملة بدل الاجازة'
            : `تسوية جزئية (${roundedDays} يوم)`),
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
        } بتاريخ ${dto.settlementDate} — ${roundedDays} يوم بقيمة ${totalAmount.toFixed(2)}`,
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

  async findAll(tenantId: string): Promise<Settlement[]> {
    return await this.repo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.employee', 'employee')
      .where('s.tenantId = :tenantId', { tenantId })
      .orderBy('s.createdAt', 'DESC')
      .getMany();
  }

  async findByEmployee(
    employeeId: string,
    tenantId: string,
  ): Promise<Settlement | null> {
    return await this.repo.findOne({
      where: { employeeId, tenantId },
      relations: { employee: true },
      order: { createdAt: 'DESC' },
    });
  }
}
