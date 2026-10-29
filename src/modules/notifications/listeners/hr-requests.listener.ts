// src/modules/notifications/listeners/hr-requests.listener.ts
// طلبات الموظفين: الجديد لمن يعتمده (في فرع الموظف)، والقرار لصاحبه.
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PERMS } from '../../../common/constants/permissions';
import type {
  DayValue,
  DomainEventMap,
} from '../../../common/events/domain-events';
import type { NotificationDetail } from '../entities/notification.entity';
import { Audience } from '../notification-audience.service';
import {
  dayKey,
  dayText,
  employeeDetail,
  type EmployeeRef,
  NotificationLookupService,
} from '../notification-lookup.service';
import type { NotificationSeverity } from '../notification-types';
import { NotifierService } from '../notifier.service';

const LEAVE_TYPE_LABEL: Record<string, string> = {
  annual: 'إجازة سنوية',
  unpaid: 'إجازة بدون راتب',
  other: 'إجازة',
};

const DECISION: Record<
  string,
  { word: string; severity: NotificationSeverity } | undefined
> = {
  approved: { word: 'اعتُمد', severity: 'success' },
  rejected: { word: 'رُفض', severity: 'danger' },
};

/** عدد أيام فترة شاملة طرفيها */
const daysBetween = (start: DayValue, end: DayValue): number =>
  Math.round(
    (Date.parse(dayKey(end)) - Date.parse(dayKey(start))) / 86_400_000,
  ) + 1;

const EVENT = { async: true } as const;

/** سجّلته الإدارة باسم الموظف (لا هو بنفسه) */
const onBehalf = (
  actorUserId: string | null | undefined,
  employee: EmployeeRef,
): boolean => !!actorUserId && employee.userId !== actorUserId;

@Injectable()
export class HrRequestsListener {
  constructor(
    private readonly notifier: NotifierService,
    private readonly lookup: NotificationLookupService,
  ) {}

  // ─── الإجازات ───────────────────────────────────────

  @OnEvent('leave.requested', EVENT)
  async onLeaveRequested(e: DomainEventMap['leave.requested']): Promise<void> {
    const employee = await this.lookup.employee(e.tenantId, e.employeeId);
    if (!employee) return;
    const label = LEAVE_TYPE_LABEL[e.leaveType] ?? 'إجازة';
    const days = daysBetween(e.startDate, e.endDate);
    const period = `من ${dayText(e.startDate)} إلى ${dayText(e.endDate)} (${days} يوم)`;
    const details: NotificationDetail[] = [
      employeeDetail(employee),
      { label: 'النوع', value: label },
      { label: 'من', value: dayKey(e.startDate), format: 'date' },
      { label: 'إلى', value: dayKey(e.endDate), format: 'date' },
      { label: 'المدة', value: `${days} يوم` },
    ];
    const entity = { type: 'leave', id: e.leaveId };

    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'leave_request',
      title: `طلب ${label} من ${employee.fullName}`,
      body: `${period} — بانتظار الاعتماد`,
      details,
      entity,
      link: '/dashboard/leaves',
      to: Audience.can(PERMS.LEAVE_APPROVE.name, employee.branchId),
      exclude: [e.actorUserId, employee.userId],
      dedupeKey: `leave_request:${e.leaveId}`,
    });

    if (onBehalf(e.actorUserId, employee)) {
      await this.notifier.notifySafe({
        tenantId: e.tenantId,
        type: 'leave_decision',
        title: `سُجّل طلب ${label} باسمك`,
        body: `${period} — بانتظار الاعتماد`,
        details,
        entity,
        link: '/dashboard/leaves',
        to: Audience.employee(e.employeeId),
        exclude: [e.actorUserId],
      });
    }
  }

  @OnEvent('leave.decided', EVENT)
  async onLeaveDecided(e: DomainEventMap['leave.decided']): Promise<void> {
    const decision = DECISION[e.status];
    if (!decision) return;
    const label = LEAVE_TYPE_LABEL[e.leaveType] ?? 'إجازة';
    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'leave_decision',
      severity: decision.severity,
      title: `${decision.word} طلب ${label}`,
      body: `طلبك من ${dayText(e.startDate)} إلى ${dayText(e.endDate)} ${decision.word}`,
      details: [
        { label: 'النوع', value: label },
        { label: 'من', value: dayKey(e.startDate), format: 'date' },
        { label: 'إلى', value: dayKey(e.endDate), format: 'date' },
        { label: 'المدة', value: `${daysBetween(e.startDate, e.endDate)} يوم` },
      ],
      entity: { type: 'leave', id: e.leaveId },
      link: '/dashboard/leaves',
      to: Audience.employee(e.employeeId),
      exclude: [e.actorUserId],
    });
  }

  // ─── السلف ──────────────────────────────────────────

  @OnEvent('advance.requested', EVENT)
  async onAdvanceRequested(
    e: DomainEventMap['advance.requested'],
  ): Promise<void> {
    const employee = await this.lookup.employee(e.tenantId, e.employeeId);
    if (!employee) return;
    const amount = await this.lookup.money(e.tenantId, e.amount);
    const details: NotificationDetail[] = [
      employeeDetail(employee),
      { label: 'المبلغ', value: e.amount, format: 'money' },
      { label: 'تاريخ السداد', value: dayKey(e.repaymentDate), format: 'date' },
    ];

    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'advance_request',
      title: `طلب سلفة من ${employee.fullName}`,
      body: `سلفة بمبلغ ${amount} — بانتظار الاعتماد`,
      details,
      entity: { type: 'advance', id: e.advanceId },
      link: '/dashboard/advances',
      to: Audience.can(PERMS.ADVANCE_APPROVE.name, employee.branchId),
      exclude: [e.actorUserId, employee.userId],
      dedupeKey: `advance_request:${e.advanceId}`,
    });

    if (onBehalf(e.actorUserId, employee)) {
      await this.notifier.notifySafe({
        tenantId: e.tenantId,
        type: 'advance_decision',
        title: 'سُجّل طلب سلفة باسمك',
        body: `سلفة بمبلغ ${amount} — بانتظار الاعتماد`,
        details,
        entity: { type: 'advance', id: e.advanceId },
        link: '/dashboard/profile',
        to: Audience.employee(e.employeeId),
        exclude: [e.actorUserId],
      });
    }
  }

  @OnEvent('advance.decided', EVENT)
  async onAdvanceDecided(e: DomainEventMap['advance.decided']): Promise<void> {
    const decision = DECISION[e.status];
    if (!decision) return;
    const amount = await this.lookup.money(e.tenantId, e.amount);
    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'advance_decision',
      severity: decision.severity,
      title: `${decision.word} طلب السلفة`,
      body: `طلب سلفتك بمبلغ ${amount} ${decision.word}`,
      details: [{ label: 'المبلغ', value: e.amount, format: 'money' }],
      entity: { type: 'advance', id: e.advanceId },
      link: '/dashboard/profile',
      to: Audience.employee(e.employeeId),
      exclude: [e.actorUserId],
    });
  }

  // ─── القروض ─────────────────────────────────────────

  @OnEvent('loan.requested', EVENT)
  async onLoanRequested(e: DomainEventMap['loan.requested']): Promise<void> {
    const employee = await this.lookup.employee(e.tenantId, e.employeeId);
    if (!employee) return;
    const amount = await this.lookup.money(e.tenantId, e.amount);
    const details: NotificationDetail[] = [
      employeeDetail(employee),
      { label: 'المبلغ', value: e.amount, format: 'money' },
      { label: 'عدد الأقساط', value: e.installments },
    ];

    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'loan_request',
      title: `طلب قرض من ${employee.fullName}`,
      body: `قرض بمبلغ ${amount} على ${e.installments} قسط — بانتظار الاعتماد`,
      details,
      entity: { type: 'loan', id: e.loanId },
      link: '/dashboard/loans',
      to: Audience.can(PERMS.LOAN_APPROVE.name, employee.branchId),
      exclude: [e.actorUserId, employee.userId],
      dedupeKey: `loan_request:${e.loanId}`,
    });

    if (onBehalf(e.actorUserId, employee)) {
      await this.notifier.notifySafe({
        tenantId: e.tenantId,
        type: 'loan_decision',
        title: 'سُجّل طلب قرض باسمك',
        body: `قرض بمبلغ ${amount} على ${e.installments} قسط — بانتظار الاعتماد`,
        details,
        entity: { type: 'loan', id: e.loanId },
        link: '/dashboard/profile',
        to: Audience.employee(e.employeeId),
        exclude: [e.actorUserId],
      });
    }
  }

  @OnEvent('loan.decided', EVENT)
  async onLoanDecided(e: DomainEventMap['loan.decided']): Promise<void> {
    const decision = DECISION[e.status];
    if (!decision) return;
    const amount = await this.lookup.money(e.tenantId, e.amount);
    const installment = await this.lookup.money(
      e.tenantId,
      e.monthlyInstallment,
    );
    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'loan_decision',
      severity: decision.severity,
      title: `${decision.word} طلب القرض`,
      body:
        e.status === 'approved'
          ? `اعتُمد قرضك بمبلغ ${amount}، ويُخصم ${installment} شهرياً من راتبك`
          : `رُفض طلب قرضك بمبلغ ${amount}`,
      details: [
        { label: 'المبلغ', value: e.amount, format: 'money' },
        { label: 'القسط الشهري', value: e.monthlyInstallment, format: 'money' },
      ],
      entity: { type: 'loan', id: e.loanId },
      link: '/dashboard/profile',
      to: Audience.employee(e.employeeId),
      exclude: [e.actorUserId],
    });
  }

  // ─── الاستقالات ─────────────────────────────────────

  @OnEvent('resignation.submitted', EVENT)
  async onResignationSubmitted(
    e: DomainEventMap['resignation.submitted'],
  ): Promise<void> {
    const employee = await this.lookup.employee(e.tenantId, e.employeeId);
    if (!employee) return;
    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'resignation_request',
      severity: 'warning',
      title: `طلب استقالة من ${employee.fullName}`,
      body: `آخر يوم عمل مطلوب: ${dayText(e.lastWorkingDay)} — بانتظار القرار`,
      details: [
        employeeDetail(employee),
        {
          label: 'آخر يوم عمل',
          value: dayKey(e.lastWorkingDay),
          format: 'date',
        },
        ...(e.reason ? [{ label: 'السبب', value: e.reason }] : []),
      ],
      entity: { type: 'resignation', id: e.requestId },
      link: '/dashboard/resignations',
      to: Audience.can(PERMS.RESIGNATION_APPROVE.name, employee.branchId),
      exclude: [e.actorUserId, employee.userId],
      dedupeKey: `resignation_request:${e.requestId}`,
    });
  }

  @OnEvent('resignation.decided', EVENT)
  async onResignationDecided(
    e: DomainEventMap['resignation.decided'],
  ): Promise<void> {
    const decision = DECISION[e.status];
    if (!decision) return;
    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'resignation_decision',
      severity: decision.severity,
      title: `${e.status === 'approved' ? 'قُبل' : 'رُفض'} طلب استقالتك`,
      body: e.notes
        ? `ملاحظات الإدارة: ${e.notes}`
        : 'راجع صفحة الاستقالات للتفاصيل',
      details: e.notes ? [{ label: 'ملاحظات الإدارة', value: e.notes }] : [],
      entity: { type: 'resignation', id: e.requestId },
      link: '/dashboard/resignations',
      to: Audience.employee(e.employeeId),
      exclude: [e.actorUserId],
    });
  }

  @OnEvent('resignation.cancelled', EVENT)
  async onResignationCancelled(
    e: DomainEventMap['resignation.cancelled'],
  ): Promise<void> {
    const employee = await this.lookup.employee(e.tenantId, e.employeeId);
    if (!employee) return;
    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'resignation_request',
      title: `${employee.fullName} سحب طلب استقالته`,
      body: 'أُلغي طلب الاستقالة من الموظف نفسه',
      details: [employeeDetail(employee)],
      entity: { type: 'resignation', id: e.requestId },
      link: '/dashboard/resignations',
      to: Audience.can(PERMS.RESIGNATION_APPROVE.name, employee.branchId),
      exclude: [e.actorUserId, employee.userId],
      dedupeKey: `resignation_cancelled:${e.requestId}`,
    });
  }
}
