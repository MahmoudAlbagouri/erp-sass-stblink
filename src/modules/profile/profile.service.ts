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

  async getMyProfile(userId: string, tenantId: string) {
    // ✅ جلب بيانات المستخدم المتوفرة فقط في الـ Entity
    const user = await this.userRepo.findOne({
      where: { id: userId, tenantId },
      relations: ['role'],
    });

    if (!user) throw new NotFoundException('المستخدم غير موجود');

    const employee = await this.employeeRepo.findOne({
      where: { user: { id: userId }, tenantId },
    });

    if (!employee) {
      return this.buildBasicProfile(user);
    }

    // جلب البيانات المتعددة بشكل متوازي
    const [contract, salary, leaveBalances] = await Promise.all([
      this.contractRepo.findOne({
        where: { employeeId: employee.id, tenantId },
      }),
      this.salaryRepo.findOne({ where: { employeeId: employee.id, tenantId } }),
      this.balanceRepo.find({ where: { employeeId: employee.id, tenantId } }),
    ]);

    // تحليل الإجازات
    const currentYear = new Date().getFullYear();
    const currentBalance =
      leaveBalances.find((b) => b.year === currentYear) || null;
    const leaveStatsByType = await this.getLeaveStatsByType(
      employee.id,
      tenantId,
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
      tenantId,
      salary?.totalSalary || 0,
    );
    const contractStatus = this.analyzeContractStatus(contract);

    return {
      personal: {
        // ✅ عرض البيانات المتاحة فقط + بيانات وصفية مفيدة
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role?.name,
          status: user.status, // حالة الحساب (نشط/غير نشط)
          isSuperAdmin: user.isSuperAdmin,
          joinedAt: user.created_at, // تاريخ إنشاء الحساب
        },
        employee: {
          id: employee.id,
          fullName: employee.fullName,
          employeeCode: employee.employeeCode,
          jobTitle: employee.jobTitle,
          department: employee.department,
          phone: employee.phone, // رقم الهاتف موجود في Employee وليس User
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
      },
    };
  }

  private async getLeaveStatsByType(
    employeeId: string,
    tenantId: string,
    year: number,
  ) {
    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    const requests = await this.leaveReqRepo.find({
      where: {
        employeeId,
        tenantId,
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
      hr: { contract: null, leaveBalance: null },
      financial: {
        salary: null,
        stats: { pendingAdvances: 0, pendingLoans: 0, totalDebt: 0 },
      },
    };
  }

  private async getFinancialAnalysis(
    employeeId: string,
    tenantId: string,
    totalSalary: number,
  ) {
    const activeAdvances = await this.advanceRepo.find({
      where: {
        employeeId,
        tenantId,
        status: In([AdvanceStatus.PENDING, AdvanceStatus.APPROVED]),
      },
      order: { createdAt: 'DESC' },
      take: 5,
    });

    const activeLoans = await this.loanRepo.find({
      where: {
        employeeId,
        tenantId,
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
