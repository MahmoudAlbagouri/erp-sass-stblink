// src/common/events/domain-events.ts
// أحداث النظام: الموديول يعلن «ما حدث» بعد نجاحه، ومن يهمه الأمر يستمع
// (الإشعارات اليوم، وغيرها لاحقاً) — فلا يعرف الموديول من يستمع له.
//
// حدث جديد = سطر في DomainEventMap ثم `events.emit(...)` بعد الحفظ
// (وبعد الـ commit إن كانت هناك معاملة: الحدث لا يُلغى مع rollback).
import { Global, Injectable, Module } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

/** تاريخ يوم: نص YYYY-MM-DD (عمود date) أو Date */
export type DayValue = string | Date;

/** كل حدث داخل شركة، ومعه من فعله (لا يُشعَر أحد بما فعله بنفسه) */
interface TenantEvent {
  tenantId: string;
  actorUserId?: string | null;
}

/** طلب يقدّمه الموظف لنفسه، أو تسجّله الإدارة باسمه (actorUserId غيره) */
interface EmployeeRequestEvent extends TenantEvent {
  employeeId: string;
}

export interface DomainEventMap {
  // ─── طلبات الموظفين ───────────────────────────────
  'leave.requested': EmployeeRequestEvent & {
    leaveId: string;
    leaveType: string;
    startDate: DayValue;
    endDate: DayValue;
  };
  'leave.decided': TenantEvent & {
    leaveId: string;
    employeeId: string;
    status: string;
    leaveType: string;
    startDate: DayValue;
    endDate: DayValue;
  };
  'advance.requested': EmployeeRequestEvent & {
    advanceId: string;
    amount: number;
    repaymentDate: DayValue;
  };
  'advance.decided': TenantEvent & {
    advanceId: string;
    employeeId: string;
    status: string;
    amount: number;
  };
  'advance.disbursed': TenantEvent & {
    advanceId: string;
    employeeId: string;
    amount: number;
  };
  'loan.requested': EmployeeRequestEvent & {
    loanId: string;
    amount: number;
    installments: number;
  };
  'loan.decided': TenantEvent & {
    loanId: string;
    employeeId: string;
    status: string;
    amount: number;
    monthlyInstallment: number;
  };
  'resignation.submitted': TenantEvent & {
    requestId: string;
    employeeId: string;
    lastWorkingDay: DayValue;
    reason?: string | null;
  };
  'resignation.decided': TenantEvent & {
    requestId: string;
    employeeId: string;
    status: string;
    notes?: string | null;
  };
  'resignation.cancelled': TenantEvent & {
    requestId: string;
    employeeId: string;
  };

  // ─── المستحقات والرواتب ───────────────────────────
  'bonus.approved': TenantEvent & {
    bonusId: string;
    employeeId: string;
    amount: number;
    payoutDate: DayValue;
    reason?: string | null;
  };
  'bonus.disbursed': TenantEvent & {
    bonusId: string;
    employeeId: string;
    amount: number;
  };
  'deduction.activated': TenantEvent & {
    deductionId: string;
    employeeId: string;
    totalAmount: number;
    monthlyAmount: number;
    installments: number;
    reason?: string | null;
  };
  'payroll.disbursed': TenantEvent & {
    payrollId: string;
    month: number;
    year: number;
    items: { employeeId: string; netSalary: number }[];
  };
  'settlement.confirmed': TenantEvent & {
    settlementId: string;
    employeeId: string;
    days: number;
    amount: number;
  };
  'settlement.disbursed': TenantEvent & {
    settlementId: string;
    employeeId: string;
    amount: number;
  };

  // ─── شؤون الموظفين ────────────────────────────────
  'employee.onboarded': TenantEvent & {
    employeeId: string;
    /** حساب الدخول الذي أُنشئ له (إن وُجد) */
    userId?: string | null;
  };
  'contract.renewed': TenantEvent & {
    contractId: string;
    employeeId: string;
    previousEndDate: DayValue | null;
    endDate: DayValue;
  };
  'attendance.punch_changed': TenantEvent & {
    logId: string;
    employeeId: string;
    change: 'edited' | 'manual';
    punchType: string;
    punchTime: Date;
    previousPunchTime?: Date | null;
    byName?: string | null;
    leaveReason?: string | null;
  };
  /** جهاز بصمة اتصل من عنوان IP غير الذي اعتاده */
  'attendance.device_ip_changed': TenantEvent & {
    deviceId: string;
    deviceName: string;
    branchId?: string | null;
    previousIp: string;
    ip: string;
  };
  /** اتصال برقم جهاز مقفول على عناوين أخرى: رُفض */
  'attendance.device_blocked': TenantEvent & {
    deviceId: string;
    deviceName: string;
    branchId?: string | null;
    ip: string | null;
  };

  // ─── المخزون ونقاط البيع ──────────────────────────
  'stock.transfer_sent': TenantEvent & {
    transferId: string;
    number: string;
    fromWarehouseId: string;
    toWarehouseId: string;
  };
  'stock.transfer_received': TenantEvent & {
    transferId: string;
    number: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    /** أسطر استُلم منها أقل من المرسَل */
    shortLines: number;
  };
  'pos.shift_closed': TenantEvent & {
    shiftId: string;
    deviceId: string;
    cashierName: string | null;
    expectedCash: number;
    closingCash: number;
    cashDifference: number;
  };

  // ─── المنصة والاشتراك ─────────────────────────────
  'tenant.registered': {
    tenantId: string;
    companyName: string;
    adminEmail: string;
    country?: string | null;
  };
  'subscription.updated': TenantEvent & {
    action: 'renewed' | 'plan_changed' | 'status_changed' | 'cancelled';
    status: string;
    planName?: string | null;
    endDate?: Date | null;
  };
}

export type DomainEventName = keyof DomainEventMap;

@Injectable()
export class DomainEvents {
  constructor(private readonly emitter: EventEmitter2) {}

  /** يعلن الحدث ويعود فوراً: المستمعون يعملون بعده، وفشلهم لا يمسّ العملية */
  emit<K extends DomainEventName>(name: K, payload: DomainEventMap[K]): void {
    this.emitter.emit(name, payload);
  }
}

@Global()
@Module({
  providers: [DomainEvents],
  exports: [DomainEvents],
})
export class DomainEventsModule {}
