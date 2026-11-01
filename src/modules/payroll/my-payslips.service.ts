// src/modules/payroll/my-payslips.service.ts
// قسائم الموظف لنفسه. لا تظهر قسيمة قبل تأكيد صرف المسير: المسودة قد تتغير.
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { Repository } from 'typeorm';
import { type CurrentUserData } from '../../common/decorators/current-user.decorator';
import { PayrollItem } from './entities/payroll-item.entity';

const EARNINGS: [keyof PayrollItem, string][] = [
  ['basicSalary', 'الراتب الأساسي'],
  ['housingAllowance', 'بدل السكن'],
  ['transportAllowance', 'بدل النقل'],
  ['otherAllowances', 'بدلات أخرى'],
  ['overtimeAmount', 'العمل الإضافي'],
  ['bonusesAmount', 'المكافآت'],
  ['settlementsAmount', 'بدل الإجازات'],
  ['eosAmount', 'نهاية الخدمة'],
];

const DEDUCTIONS: [keyof PayrollItem, string][] = [
  ['loanDeduction', 'قسط القرض'],
  ['advanceDeduction', 'سداد السلفة'],
  ['unpaidLeaveDeduction', 'إجازة بدون راتب'],
  ['absenceDeduction', 'الغياب'],
  ['lateDeduction', 'التأخير'],
  ['otherDeductions', 'خصومات أخرى'],
  ['prepaidBonuses', 'مكافآت صُرفت مسبقاً'],
  ['prepaidSettlements', 'بدل إجازات صُرف مسبقاً'],
  ['prepaidAllowances', 'بدلات صُرفت مسبقاً'],
];

@Injectable()
export class MyPayslipsService {
  constructor(
    @InjectRepository(PayrollItem)
    private readonly items: Repository<PayrollItem>,
  ) {}

  private employeeIdOf(user: CurrentUserData): string {
    if (!user.employeeId) {
      throw new NotFoundException('حسابك غير مرتبط بملف موظف');
    }
    return user.employeeId;
  }

  private disbursedQuery(user: CurrentUserData) {
    return this.items
      .createQueryBuilder('item')
      .innerJoinAndSelect('item.payroll', 'payroll')
      .where('item.employeeId = :employeeId', {
        employeeId: this.employeeIdOf(user),
      })
      .andWhere('payroll.tenantId = :tenantId', { tenantId: user.tenantId })
      .andWhere('payroll.isDisbursed = true');
  }

  private summaryOf(item: PayrollItem) {
    return {
      id: item.id,
      month: item.payroll.month,
      year: item.payroll.year,
      netSalary: item.netSalary,
      paymentDate: item.payroll.paymentDate,
    };
  }

  async list(user: CurrentUserData) {
    const rows = await this.disbursedQuery(user)
      .orderBy('payroll.year', 'DESC')
      .addOrderBy('payroll.month', 'DESC')
      .getMany();
    return rows.map((item) => this.summaryOf(item));
  }

  async detail(user: CurrentUserData, id: string) {
    const item = await this.disbursedQuery(user)
      .andWhere('item.id = :id', { id })
      .getOne();
    if (!item) throw new NotFoundException('القسيمة غير موجودة');

    const earnings = this.linesOf(item, EARNINGS);
    const deductions = this.linesOf(item, DEDUCTIONS);
    return {
      ...this.summaryOf(item),
      earnings,
      deductions,
      totalEarnings: this.sumOf(earnings),
      totalDeductions: this.sumOf(deductions),
      absenceDays: item.absenceDays,
      lateMinutes: item.lateMinutes,
      overtimeMinutes: item.overtimeMinutes,
      notes: item.notes ?? null,
    };
  }

  /** السطور التي لها قيمة فقط: قسيمة الموظف لا تعرض أصفاراً */
  private linesOf(item: PayrollItem, columns: [keyof PayrollItem, string][]) {
    return columns
      .map(([column, label]) => ({
        label,
        amount: new Decimal(item[column] as Decimal.Value).toString(),
      }))
      .filter((line) => !new Decimal(line.amount).isZero());
  }

  private sumOf(lines: { amount: string }[]): string {
    return lines
      .reduce((sum, line) => sum.plus(line.amount), new Decimal(0))
      .toString();
  }
}
