// src/modules/payroll/payroll.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Between, In } from 'typeorm';
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
import { Bonus } from '../bonuses/entities/bonus.entity';
import { Deduction } from '../deduction/entities/deduction.entity'; // ✅ تصحيح مسار الخصومات
import { Settlement } from '../settlements/entities/settlement.entity'; // ✅ استيراد تسوية الإجازات
import { EndOfService } from '../eos/entities/eos.entity'; // ✅ استيراد نهاية الخدمة

@Injectable()
export class PayrollService {
  constructor(
    @InjectRepository(Payroll) private payrollRepo: Repository<Payroll>,
    @InjectRepository(PayrollItem) private itemRepo: Repository<PayrollItem>,
    private dataSource: DataSource,
  ) {}

  async generateMonthlyPayroll(month: number, year: number, tenantId: string) {
    // ✅ 1. التحقق الزمني الصارم
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    if (year > currentYear) {
      throw new BadRequestException(
        `لا يمكن توليد مسير رواتب لسنة ${year}. السنة الحالية هي ${currentYear}`,
      );
    }

    if (year === currentYear && month > currentMonth) {
      throw new BadRequestException(
        `لا يمكن توليد مسير لشهر ${month}/${year}. الشهر الحالي هو ${currentMonth}/${currentYear}`,
      );
    }

    // ✅ 2. التحقق من عدم التكرار
    const existing = await this.payrollRepo.findOne({
      where: { month, year, tenantId },
    });
    if (existing) {
      throw new BadRequestException('تم إعداد مسير هذا الشهر مسبقاً');
    }

    // ✅ 3. تحديد نطاق الشهر بدقة
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    // ✅ 4. جلب البيانات الأساسية مرة واحدة
    const employees = await this.dataSource.getRepository(Employee).find({
      where: { tenantId, status: 'active' },
    });

    // ✅ 5. جلب المكافآت الخاصة بهذا الشهر
    const bonuses = await this.dataSource.getRepository(Bonus).find({
      where: {
        tenantId,
        payoutDate: Between(monthStart, monthEnd),
      },
    });

    const bonusMap = new Map<string, number>();
    for (const b of bonuses) {
      const current = bonusMap.get(b.employeeId) || 0;
      bonusMap.set(b.employeeId, current + Number(b.amount));
    }

    // ✅ 6. جلب الخصومات النشطة لهذا الشهر
    const allActiveDeductions = await this.dataSource
      .getRepository(Deduction)
      .find({
        where: {
          tenantId,
          startDate: Between(new Date(2000, 0, 1), monthEnd),
        },
      });

    const deductionMap = new Map<string, number>();
    const deductionsToProcess: Deduction[] = [];

    for (const d of allActiveDeductions) {
      if (d.paidInstallments < d.installmentsCount) {
        const current = deductionMap.get(d.employeeId) || 0;
        deductionMap.set(d.employeeId, current + Number(d.monthlyAmount));

        if (!deductionsToProcess.some((existing) => existing.id === d.id)) {
          deductionsToProcess.push(d);
        }
      }
    }

    // ✅ 7. جلب تسويات الإجازات (بدل الإجازات) لهذا الشهر
    const settlements = await this.dataSource.getRepository(Settlement).find({
      where: {
        tenantId,
        settlementDate: Between(monthStart, monthEnd),
      },
    });

    const settlementMap = new Map<string, number>();
    for (const s of settlements) {
      const current = settlementMap.get(s.employeeId) || 0;
      settlementMap.set(s.employeeId, current + Number(s.totalAmount));
    }

    // ✅ 8. جلب نهايات الخدمة التي تم صرفها في هذا الشهر
    const eosRecords = await this.dataSource.getRepository(EndOfService).find({
      where: {
        tenantId,
        payoutDate: Between(monthStart, monthEnd),
      },
    });

    const eosMap = new Map<string, number>();
    for (const e of eosRecords) {
      const current = eosMap.get(e.employeeId) || 0;
      eosMap.set(e.employeeId, current + Number(e.eosAmount));
    }

    const payrollItems: Partial<PayrollItem>[] = [];
    let grandTotal = 0;

    for (const emp of employees) {
      // جلب الراتب
      const salary = await this.dataSource.getRepository(Salary).findOne({
        where: { employeeId: emp.id, tenantId },
      });

      const basic = Number(salary?.basicSalary || 0);

      // ✅ تجميع جميع الإضافات (البدلات + المكافآت + بدل الإجازات + نهاية الخدمة)
      const bonusAmount = bonusMap.get(emp.id) || 0;
      const leaveSettlementAmount = settlementMap.get(emp.id) || 0;
      const eosAmount = eosMap.get(emp.id) || 0;

      const allowances =
        Number(salary?.housingAllowance || 0) +
        Number(salary?.transportAllowance || 0) +
        Number(salary?.otherAllowances || 0) +
        bonusAmount +
        leaveSettlementAmount + // ✅ بدل الإجازات
        eosAmount; // ✅ نهاية الخدمة

      // جلب القروض المعتمدة
      const loans = await this.dataSource.getRepository(Loan).find({
        where: { employeeId: emp.id, tenantId, status: LoanStatus.APPROVED },
      });
      const loanDeduction = loans.reduce(
        (sum, l) => sum + Number(l.monthlyInstallment),
        0,
      );

      // جلب السلف المستحقة لهذا الشهر
      const advances = await this.dataSource.getRepository(Advance).find({
        where: {
          employeeId: emp.id,
          tenantId,
          status: In([AdvanceStatus.APPROVED]),
          repaymentDate: Between(monthStart, monthEnd),
        },
      });
      const advanceDeduction = advances.reduce(
        (sum, a) => sum + Number(a.amount),
        0,
      );

      // جلب الإجازات غير مدفوعة الأجر
      const unpaidLeaves = await this.dataSource
        .getRepository(LeaveRequest)
        .find({
          where: {
            employeeId: emp.id,
            tenantId,
            type: LeaveType.UNPAID,
            status: LeaveStatus.APPROVED,
            startDate: Between(monthStart, monthEnd),
          },
        });

      const unpaidDays = unpaidLeaves.length;
      const dailyRate = basic > 0 ? basic / 30 : 0;
      const unpaidLeaveDeduction = unpaidDays * dailyRate;

      // ✅ إضافة الخصومات المخصصة
      const customDeductionAmount = deductionMap.get(emp.id) || 0;

      // ✅ الحساب النهائي
      const gross = basic + allowances;
      const totalDeductions =
        loanDeduction +
        advanceDeduction +
        unpaidLeaveDeduction +
        customDeductionAmount;

      const net = Math.max(0, gross - totalDeductions);

      payrollItems.push({
        employeeId: emp.id,
        basicSalary: basic,
        allowances, // ✅ يحتوي الآن على البدلات + المكافآت + بدل الإجازات + نهاية الخدمة
        loanDeduction,
        advanceDeduction,
        unpaidLeaveDeduction,
        otherDeductions: customDeductionAmount,
        netSalary: net,
      });

      grandTotal += net;
    }

    // ✅ 9. حفظ البيانات ضمن Transaction لضمان السلامة الذرية
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
      });

      const savedItems = payrollItems.map((item) => ({
        ...item,
        payrollId: payroll.id,
      }));
      await queryRunner.manager.save(PayrollItem, savedItems);

      // ✅ 10. زيادة عداد الدفعات المدفوعة للخصومات بعد نجاح حفظ المسير
      if (deductionsToProcess.length > 0) {
        await queryRunner.manager.increment(
          Deduction,
          { id: In(deductionsToProcess.map((d) => d.id)) },
          'paidInstallments',
          1,
        );
      }

      await queryRunner.commitTransaction();
      return payroll;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  // ✅ جديدة: جلب كل المسيرات مع فلاتر اختيارية
  async findAllPayrolls(tenantId: string, year?: number, month?: number) {
    const where: any = { tenantId };
    if (year) where.year = year;
    if (month && year) where.month = month;

    return this.payrollRepo.find({
      where,
      relations: ['items', 'items.employee'],
      order: { year: 'DESC', month: 'DESC' },
    });
  }

  // ✅ محسنة: جلب مسير محدد للشهر/السنة
  async findByMonth(month: number, year: number, tenantId: string) {
    return this.payrollRepo.find({
      where: { month, year, tenantId },
    });
  }

  async findOneWithDetails(id: string, tenantId: string) {
    return this.payrollRepo.findOne({
      where: { id, tenantId },
      relations: ['items', 'items.employee'],
      order: { items: { netSalary: 'DESC' } },
    });
  }
}
