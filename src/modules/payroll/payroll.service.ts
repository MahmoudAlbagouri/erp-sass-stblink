import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  DataSource,
  Between,
  In,
  LessThanOrEqual,
  MoreThanOrEqual,
} from 'typeorm';
import { Payroll } from './entities/payroll.entity';
import { PayrollItem } from './entities/payroll-item.entity';
import { Salary } from '../salaries/entities/salary.entity';
import { Loan, LoanStatus } from '../loans/entities/loan.entity';
import { Advance, AdvanceStatus } from '../advances/entities/advance.entity';
import {
  LeaveRequest,
  LeaveStatus,
  LeaveType,
} from '../leaves/entities/leave-request.entity';
import { Employee } from '../employees/entities/employee.entity';
import { Bonus, BonusStatus } from '../bonuses/entities/bonus.entity';
import {
  Deduction,
  DeductionStatus,
} from '../deduction/entities/deduction.entity';
import { Settlement } from '../settlements/entities/settlement.entity';
import { EndOfService } from '../eos/entities/eos.entity';

/** تقريب مالي لمنزلتين عشريتين لتفادي كسور الفاصلة العائمة في جافاسكريبت */
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * عدد الأيام الفعلي المتداخل بين مدة الإجازة [start,end] ونطاق الشهر
 * [rangeStart,rangeEnd] شاملاً الطرفين. يعالج الإجازات التي تبدأ قبل
 * الشهر أو تمتد بعده بحساب الجزء المتداخل فقط.
 */
function overlapDaysInclusive(
  start: Date,
  end: Date,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  const effectiveStart = start > rangeStart ? start : rangeStart;
  const effectiveEnd = end < rangeEnd ? end : rangeEnd;
  if (effectiveEnd < effectiveStart) return 0;

  // تطبيع للتوقيت منتصف الليل لتفادي مشاكل فروق التوقيت الصيفي
  const startMidnight = new Date(
    effectiveStart.getFullYear(),
    effectiveStart.getMonth(),
    effectiveStart.getDate(),
  );
  const endMidnight = new Date(
    effectiveEnd.getFullYear(),
    effectiveEnd.getMonth(),
    effectiveEnd.getDate(),
  );
  const msPerDay = 1000 * 60 * 60 * 24;
  return (
    Math.round((endMidnight.getTime() - startMidnight.getTime()) / msPerDay) + 1
  );
}

@Injectable()
export class PayrollService {
  constructor(
    @InjectRepository(Payroll) private payrollRepo: Repository<Payroll>,
    @InjectRepository(PayrollItem) private itemRepo: Repository<PayrollItem>,
    private dataSource: DataSource,
  ) {}

  /**
   * ✅ توليد مسودة المسير الشهري فقط — بدون أي أثر جانبي مالي.
   * لا يتم هنا: ترقيم أقساط القروض/الخصومات، ولا تغيير حالة أي كيان
   * آخر. كل التعديلات المالية تحدث حصرياً داخل disbursePayroll.
   */
  async generateMonthlyPayroll(month: number, year: number, tenantId: string) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    if (year > currentYear || (year === currentYear && month > currentMonth)) {
      throw new BadRequestException('لا يمكن توليد مسير رواتب لتاريخ مستقبلي');
    }

    const existing = await this.payrollRepo.findOne({
      where: { month, year, tenantId },
    });
    if (existing)
      throw new BadRequestException('تم إعداد مسير هذا الشهر مسبقاً');

    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    const employees = await this.dataSource
      .getRepository(Employee)
      .find({ where: { tenantId, status: 'active' } });

    if (employees.length === 0) {
      throw new BadRequestException('لا يوجد موظفون نشطون لتوليد المسير');
    }

    const employeeIds = employees.map((e) => e.id);

    // ================= Batch Queries — لا استعلامات داخل الـ Loop =================
    const [
      salaries,
      bonuses,
      settlements,
      eosRecords,
      activeDeductions,
      activeLoans,
      advances,
      unpaidLeaves,
    ] = await Promise.all([
      this.dataSource
        .getRepository(Salary)
        .find({ where: { employeeId: In(employeeIds), tenantId } }),

      // ✅ نجلب المكافآت المعتمدة فقط (المكافآت المعلقة/المرفوضة لا تُصرف)
      this.dataSource.getRepository(Bonus).find({
        where: {
          tenantId,
          employeeId: In(employeeIds),
          status: BonusStatus.APPROVED,
          payoutDate: Between(monthStart, monthEnd),
        },
      }),

      this.dataSource.getRepository(Settlement).find({
        where: {
          tenantId,
          employeeId: In(employeeIds),
          settlementDate: Between(monthStart, monthEnd),
        },
      }),

      this.dataSource.getRepository(EndOfService).find({
        where: {
          tenantId,
          employeeId: In(employeeIds),
          payoutDate: Between(monthStart, monthEnd),
        },
      }),

      this.dataSource.getRepository(Deduction).find({
        where: {
          tenantId,
          employeeId: In(employeeIds),
          startDate: LessThanOrEqual(monthEnd),
        },
      }),

      this.dataSource.getRepository(Loan).find({
        where: {
          tenantId,
          employeeId: In(employeeIds),
          status: LoanStatus.APPROVED,
          startDate: LessThanOrEqual(monthEnd),
        },
      }),

      this.dataSource.getRepository(Advance).find({
        where: {
          tenantId,
          employeeId: In(employeeIds),
          status: AdvanceStatus.APPROVED,
          repaymentDate: Between(monthStart, monthEnd),
        },
      }),

      // ✅ أي إجازة غير مدفوعة تتداخل فعلياً مع نطاق الشهر (وليس فقط
      // startDate بداخله) — الفلترة الدقيقة باليوم تحدث أدناه
      this.dataSource.getRepository(LeaveRequest).find({
        where: {
          tenantId,
          employeeId: In(employeeIds),
          type: LeaveType.UNPAID,
          status: LeaveStatus.APPROVED,
          startDate: LessThanOrEqual(monthEnd),
          endDate: MoreThanOrEqual(monthStart),
        },
      }),
    ]);

    // ================= تجميع كل شيء في Maps بمفتاح employeeId =================
    const salaryMap = new Map(salaries.map((s) => [s.employeeId, s]));

    const bonusMap = new Map<string, number>();
    const prepaidBonusMap = new Map<string, number>();
    for (const b of bonuses) {
      const amount = Number(b.amount);
      bonusMap.set(b.employeeId, (bonusMap.get(b.employeeId) || 0) + amount);
      if (b.isDisbursed) {
        prepaidBonusMap.set(
          b.employeeId,
          (prepaidBonusMap.get(b.employeeId) || 0) + amount,
        );
      }
    }

    const settlementMap = new Map<string, number>();
    const prepaidSettlementMap = new Map<string, number>();
    for (const s of settlements) {
      const amount = Number(s.totalAmount);
      settlementMap.set(
        s.employeeId,
        (settlementMap.get(s.employeeId) || 0) + amount,
      );
      if (s.isDisbursed) {
        prepaidSettlementMap.set(
          s.employeeId,
          (prepaidSettlementMap.get(s.employeeId) || 0) + amount,
        );
      }
    }

    const eosMap = new Map<string, number>();
    for (const e of eosRecords)
      eosMap.set(
        e.employeeId,
        (eosMap.get(e.employeeId) || 0) + Number(e.eosAmount),
      );

    // للعرض في القسيمة فقط — الترقيم الفعلي لـ paidInstallments يحدث
    // حصرياً داخل disbursePayroll
    const deductionMap = new Map<string, number>();
    for (const d of activeDeductions) {
      if (d.paidInstallments < d.installmentsCount) {
        deductionMap.set(
          d.employeeId,
          (deductionMap.get(d.employeeId) || 0) + Number(d.monthlyAmount),
        );
      }
    }

    const loanMap = new Map<string, number>();
    for (const loan of activeLoans) {
      if (loan.paidInstallments < loan.installmentsCount) {
        loanMap.set(
          loan.employeeId,
          (loanMap.get(loan.employeeId) || 0) + Number(loan.monthlyInstallment),
        );
      }
    }

    const advanceMap = new Map<string, number>();
    for (const a of advances)
      advanceMap.set(
        a.employeeId,
        (advanceMap.get(a.employeeId) || 0) + Number(a.amount),
      );

    // ✅ الفارق الفعلي بالأيام (وليس عدد الريكوردات) لكل إجازة غير
    // مدفوعة، مقصوصاً على حدود الشهر المالي
    const unpaidLeaveMap = new Map<string, number>();
    for (const leave of unpaidLeaves) {
      const days = overlapDaysInclusive(
        new Date(leave.startDate),
        new Date(leave.endDate),
        monthStart,
        monthEnd,
      );
      if (days <= 0) continue;
      unpaidLeaveMap.set(
        leave.employeeId,
        (unpaidLeaveMap.get(leave.employeeId) || 0) + days,
      );
    }

    // ================= بناء عناصر المسير (بدون أي استعلام إضافي) =================
    const payrollItems: Partial<PayrollItem>[] = [];
    let grandTotal = 0;

    for (const emp of employees) {
      const salary = salaryMap.get(emp.id);
      const basic = Number(salary?.basicSalary || 0);
      const housingAllowance = Number(salary?.housingAllowance || 0);
      const transportAllowance = Number(salary?.transportAllowance || 0);
      const otherAllowances = Number(salary?.otherAllowances || 0);

      const bonusesAmount = bonusMap.get(emp.id) || 0;
      const settlementsAmount = settlementMap.get(emp.id) || 0;
      const eosAmount = eosMap.get(emp.id) || 0;

      const prepaidBonuses = prepaidBonusMap.get(emp.id) || 0;
      const prepaidSettlements = prepaidSettlementMap.get(emp.id) || 0;

      const loanDeduction = loanMap.get(emp.id) || 0;
      const advanceDeduction = advanceMap.get(emp.id) || 0;

      const unpaidDays = unpaidLeaveMap.get(emp.id) || 0;
      const dailyRate = basic > 0 ? basic / 30 : 0;
      const unpaidLeaveDeduction = unpaidDays * dailyRate;

      const otherDeductions = deductionMap.get(emp.id) || 0;

      // Net Salary = (Basic + Allowances + Bonuses/Settlements/EOS)
      //            - (Loans + Advances + UnpaidLeave + OtherDeductions + Prepaid)
      // ملاحظة: bonusesAmount/settlementsAmount يشملان كامل المستحق
      // (مصروف سلفاً + غير مصروف) للشفافية في القسيمة، ثم يُخصم الجزء
      // المصروف سلفاً (prepaid) فوراً من الصافي لمنع ازدواجية الصرف.
      const gross =
        basic +
        housingAllowance +
        transportAllowance +
        otherAllowances +
        bonusesAmount +
        settlementsAmount +
        eosAmount;

      const totalDeductions =
        loanDeduction +
        advanceDeduction +
        unpaidLeaveDeduction +
        otherDeductions +
        prepaidBonuses +
        prepaidSettlements;

      const net = roundMoney(Math.max(0, gross - totalDeductions));

      payrollItems.push({
        employeeId: emp.id,
        basicSalary: roundMoney(basic),
        housingAllowance: roundMoney(housingAllowance),
        transportAllowance: roundMoney(transportAllowance),
        otherAllowances: roundMoney(otherAllowances),
        overtimeAmount: 0,
        bonusesAmount: roundMoney(bonusesAmount),
        settlementsAmount: roundMoney(settlementsAmount),
        eosAmount: roundMoney(eosAmount),
        prepaidBonuses: roundMoney(prepaidBonuses),
        prepaidSettlements: roundMoney(prepaidSettlements),
        prepaidAllowances: 0,
        loanDeduction: roundMoney(loanDeduction),
        advanceDeduction: roundMoney(advanceDeduction),
        unpaidLeaveDeduction: roundMoney(unpaidLeaveDeduction),
        otherDeductions: roundMoney(otherDeductions),
        netSalary: net,
      });

      grandTotal += net;
    }

    grandTotal = roundMoney(grandTotal);

    // ================= حفظ المسودة فقط =================
    // ⚠️ ممنوع هنا أي تعديل على Loan / Deduction أو أي كيان آخر.
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const payroll = await queryRunner.manager.save(Payroll, {
        month,
        year,
        tenantId,
        totalNetSalary: grandTotal,
        paymentDate: new Date(),
        isDisbursed: false,
      });

      await queryRunner.manager.save(
        PayrollItem,
        payrollItems.map((item) => ({ ...item, payrollId: payroll.id })),
      );

      await queryRunner.commitTransaction();
      return payroll;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * ✅ تأكيد صرف المسير — هنا فقط تحدث كل الآثار الجانبية المالية:
   * - ترقيم أقساط القروض والخصومات المخصصة النشطة لموظفي هذا المسير
   * - إكمال (COMPLETED) القروض/الخصومات التي اكتمل سدادها بهذا القسط
   * - تسجيل بيانات الصرف (isDisbursed / disbursedById / disbursedAt)
   * كل ذلك داخل معاملة ACID واحدة (QueryRunner) مع Rollback كامل عند
   * أي خطأ، وضمان release() دائماً.
   */
  async disbursePayroll(
    payrollId: string,
    tenantId: string,
    userId: string,
  ): Promise<Payroll> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. جلب المسير + عناصره مع التحقق من عزل المستأجرين (Multi-tenancy)
      const payroll = await queryRunner.manager.findOne(Payroll, {
        where: { id: payrollId, tenantId },
        relations: ['items'],
        lock: { mode: 'pessimistic_write' },
      });

      if (!payroll) {
        throw new NotFoundException(
          'المسير غير موجود أو لا ينتمي لهذه المؤسسة',
        );
      }
      if (payroll.isDisbursed) {
        throw new BadRequestException('تم صرف هذا المسير مسبقاً');
      }

      const employeeIds = payroll.items.map((i) => i.employeeId);

      if (employeeIds.length > 0) {
        const monthStart = new Date(payroll.year, payroll.month - 1, 1);
        const monthEnd = new Date(payroll.year, payroll.month, 0, 23, 59, 59);

        // 2. نفس معايير الجلب المستخدمة وقت توليد المسودة، لضمان ترقيم
        // نفس السجلات بالضبط التي احتُسبت فيها
        const [activeLoans, activeDeductions] = await Promise.all([
          queryRunner.manager.find(Loan, {
            where: {
              tenantId,
              employeeId: In(employeeIds),
              status: LoanStatus.APPROVED,
              startDate: LessThanOrEqual(monthEnd),
            },
          }),
          queryRunner.manager.find(Deduction, {
            where: {
              tenantId,
              employeeId: In(employeeIds),
              startDate: LessThanOrEqual(monthEnd),
            },
          }),
        ]);

        const loansToIncrement = activeLoans.filter(
          (l) => l.paidInstallments < l.installmentsCount,
        );
        const deductionsToIncrement = activeDeductions.filter(
          (d) => d.paidInstallments < d.installmentsCount,
        );

        if (deductionsToIncrement.length > 0) {
          await queryRunner.manager.increment(
            Deduction,
            { id: In(deductionsToIncrement.map((d) => d.id)) },
            'paidInstallments',
            1,
          );

          const nowCompleted = deductionsToIncrement.filter(
            (d) => d.paidInstallments + 1 >= d.installmentsCount,
          );
          if (nowCompleted.length > 0) {
            await queryRunner.manager.update(
              Deduction,
              { id: In(nowCompleted.map((d) => d.id)) },
              { status: DeductionStatus.COMPLETED },
            );
          }
        }

        if (loansToIncrement.length > 0) {
          await queryRunner.manager.increment(
            Loan,
            { id: In(loansToIncrement.map((l) => l.id)) },
            'paidInstallments',
            1,
          );

          const nowCompleted = loansToIncrement.filter(
            (l) => l.paidInstallments + 1 >= l.installmentsCount,
          );
          if (nowCompleted.length > 0) {
            await queryRunner.manager.update(
              Loan,
              { id: In(nowCompleted.map((l) => l.id)) },
              { status: LoanStatus.COMPLETED },
            );
          }
        }
      }

      // 3. تسجيل بيانات الصرف
      payroll.isDisbursed = true;
      payroll.disbursedById = userId;
      payroll.disbursedAt = new Date();
      await queryRunner.manager.save(Payroll, payroll);

      await queryRunner.commitTransaction();

      // إعادة الجلب مع العلاقات كاملة للفرونت
      return await this.payrollRepo.findOneOrFail({
        where: { id: payrollId, tenantId },
        relations: ['items', 'items.employee', 'disbursedBy'],
      });
    } catch (err) {
      await queryRunner.rollbackTransaction();
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException
      ) {
        throw err;
      }
      throw new BadRequestException('حدث خطأ أثناء تأكيد عملية الصرف');
    } finally {
      await queryRunner.release();
    }
  }

  async findAllPayrolls(tenantId: string, year?: number, month?: number) {
    const where: any = { tenantId };
    if (year) where.year = year;
    if (month && year) where.month = month;
    return this.payrollRepo.find({
      where,
      relations: ['items', 'items.employee', 'disbursedBy'],
      order: { year: 'DESC', month: 'DESC' },
    });
  }

  async findByMonth(month: number, year: number, tenantId: string) {
    return this.payrollRepo.find({ where: { month, year, tenantId } });
  }

  async findOneWithDetails(id: string, tenantId: string) {
    return this.payrollRepo.findOne({
      where: { id, tenantId },
      relations: ['items', 'items.employee', 'disbursedBy'],
      order: { items: { netSalary: 'DESC' } },
    });
  }
}
