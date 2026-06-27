// src/modules/profile/profile.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThanOrEqual } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Employee } from '../employees/entities/employee.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { Salary } from '../salaries/entities/salary.entity';
import { LeaveBalance } from '../leaves/entities/leave-balance.entity';
import {
  LeaveRequest,
  LeaveType,
  LeaveStatus,
} from '../leaves/entities/leave-request.entity';
import { Advance, AdvanceStatus } from '../advances/entities/advance.entity';
import { Loan, LoanStatus } from '../loans/entities/loan.entity';
import { type CurrentUserData } from '../../common/decorators/current-user.decorator';

@Injectable()
export class ProfileService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Employee) private employeeRepo: Repository<Employee>,
    @InjectRepository(Contract) private contractRepo: Repository<Contract>,
    @InjectRepository(Salary) private salaryRepo: Repository<Salary>,
    @InjectRepository(LeaveBalance)
    private balanceRepo: Repository<LeaveBalance>,
    @InjectRepository(LeaveRequest)
    private leaveReqRepo: Repository<LeaveRequest>,
    @InjectRepository(Advance) private advanceRepo: Repository<Advance>,
    @InjectRepository(Loan) private loanRepo: Repository<Loan>,
  ) {}

  async getMyProfile(user: CurrentUserData) {
    const userData = await this.userRepo.findOne({
      where: { id: user.id },
      relations: ['role'],
    });

    if (!userData) throw new NotFoundException('المستخدم غير موجود');

    const employee = await this.employeeRepo.findOne({
      where: { user: { id: user.id } },
    });

    if (!employee) {
      return this.buildBasicProfile(userData);
    }

    // جلب البيانات الأساسية
    const [contract, salary, leaveBalances] = await Promise.all([
      this.contractRepo.findOne({
        where: { employeeId: employee.id },
      }),
      this.salaryRepo.findOne({
        where: { employeeId: employee.id },
      }),
      this.balanceRepo.find({
        where: { employeeId: employee.id },
      }),
    ]);

    // تحليل الإجازات الحالية
    const currentYear = new Date().getFullYear();
    const currentBalance =
      leaveBalances.find((b) => b.year === currentYear) || null;

    // ✅ جلب سجل الإجازات الكامل (موافق، معلق، مرفوض)
    const leaveHistory = await this.getLeaveHistory(employee.id);

    const leaveStatsByType = await this.getLeaveStatsByType(
      employee.id,
      currentYear,
    );

    let leaveAnalysis: any = null;
    if (currentBalance) {
      const remaining =
        currentBalance.totalAllowance - currentBalance.consumedDays;
      leaveAnalysis = {
        year: currentYear,
        totalAllowance: currentBalance.totalAllowance,
        consumedDays: currentBalance.consumedDays,
        remaining,
        usagePercentage:
          currentBalance.totalAllowance > 0
            ? Math.round(
                (currentBalance.consumedDays / currentBalance.totalAllowance) *
                  100,
              )
            : 0,
        breakdown: leaveStatsByType,
      };
    } else if (contract) {
      leaveAnalysis = {
        year: currentYear,
        totalAllowance: contract.annualLeaveDays || 0,
        consumedDays: 0,
        remaining: contract.annualLeaveDays || 0,
        usagePercentage: 0,
        breakdown: leaveStatsByType,
      };
    }

    // التحليل المالي والإحصائيات
    const financialStats = await this.getFinancialAnalysis(
      employee.id,
      salary?.totalSalary || 0,
    );

    // ✅ جلب القروض والسلف المرفوضة
    const rejectedLoans = await this.getRejectedLoans(employee.id);
    const rejectedAdvances = await this.getRejectedAdvances(employee.id);

    const contractStatus = this.analyzeContractStatus(contract);

    return {
      personal: {
        user: {
          id: userData.id,
          email: userData.email,
          username: userData.username,
          role: userData.role?.name,
          status: userData.status,
          isSuperAdmin: userData.isSuperAdmin,
          joinedAt: userData.created_at,
        },
        employee: {
          id: employee.id,
          fullName: employee.fullName,
          employeeCode: employee.employeeCode,
          jobTitle: employee.jobTitle,
          department: employee.department,
          phone: employee.phone,
          joinDate: employee.createdAt,
          nationalityType: employee.nationalityType,
        },
      },
      hr: {
        contract: {
          ...contract,
          statusLabel: contractStatus.label,
          isExpiringSoon: contractStatus.isExpiringSoon,
          daysUntilExpiry: contractStatus.daysUntilExpiry,
        },
        leaveBalance: leaveAnalysis,
        leaveHistory: leaveHistory, // ✅ إضافة سجل الإجازات
      },
      financial: {
        salary: salary
          ? {
              basic: salary.basicSalary,
              allowances:
                salary.housingAllowance +
                salary.transportAllowance +
                salary.otherAllowances,
              total: salary.totalSalary,
            }
          : null,
        stats: financialStats,
        rejectedLoans: rejectedLoans, // ✅ إضافة القروض المرفوضة
        rejectedAdvances: rejectedAdvances, // ✅ إضافة السلف المرفوضة
      },
    };
  }

  // ✅ دالة جديدة لجلب سجل الإجازات الكامل
  private async getLeaveHistory(employeeId: string) {
    const requests = await this.leaveReqRepo.find({
      where: { employeeId },
      order: { createdAt: 'DESC' },
      take: 20, // آخر 20 طلب مثلاً
    });

    return requests.map((req) => ({
      id: req.id,
      type: req.type,
      startDate: req.startDate,
      endDate: req.endDate,
      status: req.status,
      reason: req.reason,
      createdAt: req.createdAt,
      durationDays: this.calculateDuration(req.startDate, req.endDate),
    }));
  }

  // ✅ دالة مساعدة لحساب عدد الأيام
  private calculateDuration(start: Date, end: Date): number {
    const diffTime = Math.abs(
      new Date(end).getTime() - new Date(start).getTime(),
    );
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  }

  // ✅ دالة جديدة لجلب القروض المرفوضة
  private async getRejectedLoans(employeeId: string) {
    const loans = await this.loanRepo.find({
      where: {
        employeeId,
        status: LoanStatus.REJECTED,
      },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    return loans.map((l) => ({
      id: l.id,
      totalAmount: l.totalAmount,
      monthlyInstallment: l.monthlyInstallment,
      installmentsCount: l.installmentsCount,
      reason: l.reason,
      rejectedAt: l.createdAt, // يمكن إضافة حقل updatedAt إذا أردت تاريخ الرفض الدقيق
    }));
  }

  // ✅ دالة جديدة لجلب السلف المرفوضة
  private async getRejectedAdvances(employeeId: string) {
    const advances = await this.advanceRepo.find({
      where: {
        employeeId,
        status: AdvanceStatus.REJECTED,
      },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    return advances.map((a) => ({
      id: a.id,
      amount: a.amount,
      reason: a.reason,
      repaymentDate: a.repaymentDate,
      rejectedAt: a.createdAt,
    }));
  }

  private async getLeaveStatsByType(employeeId: string, year: number) {
    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    const requests = await this.leaveReqRepo.find({
      where: {
        employeeId,
        status: LeaveStatus.APPROVED,
        startDate: MoreThanOrEqual(startDate),
        endDate: MoreThanOrEqual(startDate),
      },
    });

    const stats = {
      [LeaveType.ANNUAL]: 0,
      [LeaveType.UNPAID]: 0,
      [LeaveType.OTHER]: 0,
    };

    requests.forEach((req) => {
      const diffTime = Math.abs(
        new Date(req.endDate).getTime() - new Date(req.startDate).getTime(),
      );
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

      if (stats[req.type] !== undefined) {
        stats[req.type] += diffDays;
      }
    });

    return stats;
  }

  private buildBasicProfile(user: User) {
    return {
      personal: {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role?.name,
          status: user.status,
          isSuperAdmin: user.isSuperAdmin,
          isSystemAdmin: user.isSystemAdmin,
          joinedAt: user.created_at,
        },
        employee: null,
      },
      hr: { contract: null, leaveBalance: null, leaveHistory: [] },
      financial: {
        salary: null,
        stats: { pendingAdvances: 0, pendingLoans: 0, totalDebt: 0 },
        rejectedLoans: [],
        rejectedAdvances: [],
      },
    };
  }

  private async getFinancialAnalysis(employeeId: string, totalSalary: number) {
    const activeAdvances = await this.advanceRepo.find({
      where: {
        employeeId,
        status: In([AdvanceStatus.PENDING, AdvanceStatus.APPROVED]),
      },
      order: { createdAt: 'DESC' },
      take: 5,
    });

    const activeLoans = await this.loanRepo.find({
      where: {
        employeeId,
        status: In([LoanStatus.PENDING, LoanStatus.APPROVED]),
      },
      order: { createdAt: 'DESC' },
      take: 5,
    });

    const totalPendingAdvances = activeAdvances.reduce(
      (sum, a) => sum + Number(a.amount),
      0,
    );

    const totalRemainingLoans = activeLoans.reduce((sum, l) => {
      return sum + Number(l.monthlyInstallment) * Number(l.installmentsCount);
    }, 0);

    const totalDebt = totalPendingAdvances + totalRemainingLoans;

    return {
      summary: {
        totalDebt,
        debtToSalaryRatio:
          totalSalary > 0 ? Math.round((totalDebt / totalSalary) * 100) : 0,
        pendingAdvancesCount: activeAdvances.length,
        activeLoansCount: activeLoans.length,
      },
      recentAdvances: activeAdvances.map((a) => ({
        id: a.id,
        amount: a.amount,
        status: a.status,
        requestedAt: a.createdAt,
        repaymentDate: a.repaymentDate,
      })),
      recentLoans: activeLoans.map((l) => ({
        id: l.id,
        totalAmount: l.totalAmount,
        monthlyInstallment: l.monthlyInstallment,
        installmentsCount: l.installmentsCount,
        remainingAmount:
          Number(l.monthlyInstallment) * Number(l.installmentsCount),
        status: l.status,
        startDate: l.startDate,
      })),
    };
  }

  private analyzeContractStatus(contract: Contract | null) {
    if (!contract || !contract.endDate)
      return {
        label: 'غير محدد',
        isExpiringSoon: false,
        daysUntilExpiry: null,
      };

    const today = new Date();
    const endDate = new Date(contract.endDate);
    const diffTime = endDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    const isExpiringSoon = diffDays <= 30 && diffDays >= 0;
    let label = 'نشط';
    if (diffDays < 0) label = 'منتهي';
    else if (isExpiringSoon) label = 'يوشك على الانتهاء';

    return { label, isExpiringSoon, daysUntilExpiry: diffDays };
  }
}
