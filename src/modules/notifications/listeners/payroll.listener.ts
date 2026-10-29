// src/modules/notifications/listeners/payroll.listener.ts
// مستحقات الموظف: ما يُضاف لراتبه أو يُخصم منه أو يُصرف له — يصله هو.
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEventMap } from '../../../common/events/domain-events';
import { Audience } from '../notification-audience.service';
import {
  dayKey,
  dayText,
  NotificationLookupService,
} from '../notification-lookup.service';
import { NotifierService } from '../notifier.service';

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

const EVENT = { async: true } as const;

@Injectable()
export class PayrollListener {
  constructor(
    private readonly notifier: NotifierService,
    private readonly lookup: NotificationLookupService,
  ) {}

  @OnEvent('payroll.disbursed', EVENT)
  async onPayrollDisbursed(
    e: DomainEventMap['payroll.disbursed'],
  ): Promise<void> {
    const period = `${MONTHS_AR[e.month - 1] ?? e.month} ${e.year}`;
    // راتب كل موظف إشعار له وحده (المبلغ يخصه)
    for (const item of e.items) {
      await this.notifier.notifySafe({
        tenantId: e.tenantId,
        type: 'payroll_paid',
        severity: 'success',
        title: `صُرف راتب ${period}`,
        body: `صافي راتبك: ${await this.lookup.money(e.tenantId, item.netSalary)}`,
        details: [
          { label: 'الشهر', value: period },
          { label: 'صافي الراتب', value: item.netSalary, format: 'money' },
        ],
        entity: { type: 'payroll', id: e.payrollId },
        link: '/dashboard/profile',
        to: Audience.employee(item.employeeId),
        dedupeKey: `payroll_paid:${e.payrollId}:${item.employeeId}`,
      });
    }
  }

  @OnEvent('bonus.approved', EVENT)
  async onBonusApproved(e: DomainEventMap['bonus.approved']): Promise<void> {
    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'bonus',
      severity: 'success',
      title: 'أُضيفت لك مكافأة',
      body: `مكافأة بمبلغ ${await this.lookup.money(e.tenantId, e.amount)} تُصرف مع راتب ${dayText(e.payoutDate)}`,
      details: [
        { label: 'المبلغ', value: e.amount, format: 'money' },
        { label: 'تاريخ الصرف', value: dayKey(e.payoutDate), format: 'date' },
        ...(e.reason ? [{ label: 'السبب', value: e.reason }] : []),
      ],
      entity: { type: 'bonus', id: e.bonusId },
      link: '/dashboard/profile',
      to: Audience.employee(e.employeeId),
      exclude: [e.actorUserId],
      dedupeKey: `bonus_approved:${e.bonusId}`,
    });
  }

  @OnEvent('bonus.disbursed', EVENT)
  async onBonusDisbursed(e: DomainEventMap['bonus.disbursed']): Promise<void> {
    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'bonus',
      severity: 'success',
      title: 'صُرفت مكافأتك',
      body: `صُرفت لك مكافأة بمبلغ ${await this.lookup.money(e.tenantId, e.amount)}`,
      details: [{ label: 'المبلغ', value: e.amount, format: 'money' }],
      entity: { type: 'bonus', id: e.bonusId },
      link: '/dashboard/profile',
      to: Audience.employee(e.employeeId),
      exclude: [e.actorUserId],
      dedupeKey: `bonus_disbursed:${e.bonusId}`,
    });
  }

  @OnEvent('deduction.activated', EVENT)
  async onDeductionActivated(
    e: DomainEventMap['deduction.activated'],
  ): Promise<void> {
    const total = await this.lookup.money(e.tenantId, e.totalAmount);
    const monthly = await this.lookup.money(e.tenantId, e.monthlyAmount);
    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'deduction',
      severity: 'warning',
      title: 'سُجّل خصم على راتبك',
      body:
        e.installments > 1
          ? `خصم ${total} على ${e.installments} أشهر (${monthly} شهرياً)`
          : `خصم ${total} من راتبك`,
      details: [
        { label: 'الإجمالي', value: e.totalAmount, format: 'money' },
        { label: 'الخصم الشهري', value: e.monthlyAmount, format: 'money' },
        { label: 'عدد الأشهر', value: e.installments },
        ...(e.reason ? [{ label: 'السبب', value: e.reason }] : []),
      ],
      entity: { type: 'deduction', id: e.deductionId },
      link: '/dashboard/profile',
      to: Audience.employee(e.employeeId),
      exclude: [e.actorUserId],
      dedupeKey: `deduction_active:${e.deductionId}`,
    });
  }

  @OnEvent('advance.disbursed', EVENT)
  async onAdvanceDisbursed(
    e: DomainEventMap['advance.disbursed'],
  ): Promise<void> {
    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'advance_paid',
      severity: 'success',
      title: 'سُلّمت لك السلفة',
      body: `سُجّل تسليم سلفتك بمبلغ ${await this.lookup.money(e.tenantId, e.amount)}`,
      details: [{ label: 'المبلغ', value: e.amount, format: 'money' }],
      entity: { type: 'advance', id: e.advanceId },
      link: '/dashboard/profile',
      to: Audience.employee(e.employeeId),
      exclude: [e.actorUserId],
      dedupeKey: `advance_disbursed:${e.advanceId}`,
    });
  }

  @OnEvent('settlement.confirmed', EVENT)
  async onSettlementConfirmed(
    e: DomainEventMap['settlement.confirmed'],
  ): Promise<void> {
    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'settlement',
      title: 'سُجّلت تسوية لرصيد إجازاتك',
      body: `${e.days} يوم بقيمة ${await this.lookup.money(e.tenantId, e.amount)} — خُصمت من رصيدك`,
      details: [
        { label: 'الأيام', value: `${e.days} يوم` },
        { label: 'القيمة', value: e.amount, format: 'money' },
      ],
      entity: { type: 'settlement', id: e.settlementId },
      link: '/dashboard/profile',
      to: Audience.employee(e.employeeId),
      exclude: [e.actorUserId],
      dedupeKey: `settlement_confirmed:${e.settlementId}`,
    });
  }

  @OnEvent('settlement.disbursed', EVENT)
  async onSettlementDisbursed(
    e: DomainEventMap['settlement.disbursed'],
  ): Promise<void> {
    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'settlement',
      severity: 'success',
      title: 'صُرفت تسوية إجازتك',
      body: `صُرف لك مبلغ ${await this.lookup.money(e.tenantId, e.amount)} بدل رصيد إجازة`,
      details: [{ label: 'المبلغ', value: e.amount, format: 'money' }],
      entity: { type: 'settlement', id: e.settlementId },
      link: '/dashboard/profile',
      to: Audience.employee(e.employeeId),
      exclude: [e.actorUserId],
      dedupeKey: `settlement_disbursed:${e.settlementId}`,
    });
  }
}
