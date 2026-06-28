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

    const employees = await this.dataSource.getRepository(Employee).find({
      where: { tenantId, status: 'active' },
    });

    const payrollItems: Partial<PayrollItem>[] = [];
    let grandTotal = 0;
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    for (const emp of employees) {
      const salary = await this.dataSource.getRepository(Salary).findOne({
        where: { employeeId: emp.id, tenantId },
      });

      const basic = Number(salary?.basicSalary || 0);
      const allowances =
        Number(salary?.housingAllowance || 0) +
        Number(salary?.transportAllowance || 0) +
        Number(salary?.otherAllowances || 0);

      const loans = await this.dataSource.getRepository(Loan).find({
        where: { employeeId: emp.id, tenantId, status: LoanStatus.APPROVED },
      });
      const loanDeduction = loans.reduce(
        (sum, l) => sum + Number(l.monthlyInstallment),
        0,
      );

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

      const gross = basic + allowances;
      const totalDeductions =
        loanDeduction + advanceDeduction + unpaidLeaveDeduction;
      const net = Math.max(0, gross - totalDeductions);

      payrollItems.push({
        employeeId: emp.id,
        basicSalary: basic,
        allowances,
        loanDeduction,
        advanceDeduction,
        unpaidLeaveDeduction,
        netSalary: net,
      });

      grandTotal += net;
    }

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

  // ✅ محسنة: جلب مسير محدد للشهر/السنة (بدون Relations ثقيلة للتحقق السريع)
  async findByMonth(month: number, year: number, tenantId: string) {
    return this.payrollRepo.find({
      where: { month, year, tenantId },
      // لا نجلب relations هنا لأننا نستخدمها فقط للتحقق من الوجود في التصدير
      // إذا احتجنا التفاصيل لاحقاً، نستخدم findOneWithDetails
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
