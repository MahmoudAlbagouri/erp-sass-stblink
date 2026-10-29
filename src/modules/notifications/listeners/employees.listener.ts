// src/modules/notifications/listeners/employees.listener.ts
// ملف الموظف: انضمامه، تجديد عقده، وتعديل حضوره.
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PERMS } from '../../../common/constants/permissions';
import type { DomainEventMap } from '../../../common/events/domain-events';
import { formatDate, formatDateTime } from '../../../common/utils/format.util';
import {
  PUNCH_TYPE_LABELS_AR,
  PunchType,
} from '../../attendance/entities/attendance-log.entity';
import type { NotificationDetail } from '../entities/notification.entity';
import { Audience } from '../notification-audience.service';
import {
  dayKey,
  dayText,
  employeeDetail,
  NotificationLookupService,
} from '../notification-lookup.service';
import { NotifierService } from '../notifier.service';

const EVENT = { async: true } as const;

@Injectable()
export class EmployeesListener {
  constructor(
    private readonly notifier: NotifierService,
    private readonly lookup: NotificationLookupService,
  ) {}

  @OnEvent('employee.onboarded', EVENT)
  async onOnboarded(e: DomainEventMap['employee.onboarded']): Promise<void> {
    const employee = await this.lookup.employee(e.tenantId, e.employeeId);
    if (!employee) return;
    const by = await this.lookup.userName(e.actorUserId);

    // فريق الموارد البشرية (عدا من سجّله)
    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'employee_onboarded',
      title: `انضم موظف جديد: ${employee.fullName}`,
      body: `سُجّل ${employee.fullName} (${employee.employeeCode})${by ? ` بواسطة ${by}` : ''}`,
      details: [
        employeeDetail(employee),
        ...(by ? [{ label: 'سجّله', value: by }] : []),
      ],
      entity: { type: 'employee', id: employee.id },
      link: `/dashboard/employees/${employee.id}`,
      to: Audience.can(PERMS.EMPLOYEE_ONBOARD.name, employee.branchId),
      exclude: [e.actorUserId, e.userId],
      dedupeKey: `employee_onboarded:${employee.id}`,
    });

    // ترحيب بالموظف نفسه إن أُنشئ له حساب
    if (e.userId) {
      const company = await this.lookup.companyName(e.tenantId);
      await this.notifier.notifySafe({
        tenantId: e.tenantId,
        type: 'welcome',
        severity: 'success',
        title: `مرحباً بك${company ? ` في ${company}` : ''}`,
        body: 'من هنا تتابع حضورك وطلباتك وراتبك، وتصلك رسائل الإدارة وتنبيهاتك',
        details: [employeeDetail(employee)],
        link: '/dashboard/profile',
        to: Audience.users(e.userId),
        dedupeKey: `welcome:${e.userId}`,
      });
    }
  }

  @OnEvent('contract.renewed', EVENT)
  async onContractRenewed(
    e: DomainEventMap['contract.renewed'],
  ): Promise<void> {
    const employee = await this.lookup.employee(e.tenantId, e.employeeId);
    if (!employee) return;
    const details: NotificationDetail[] = [
      employeeDetail(employee),
      { label: 'ينتهي العقد في', value: dayKey(e.endDate), format: 'date' },
    ];
    if (e.previousEndDate) {
      details.push({
        label: 'كان ينتهي في',
        value: dayKey(e.previousEndDate),
        format: 'date',
      });
    }

    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'contract_renewed',
      severity: 'success',
      title: 'جُدّد عقدك',
      body: `عقدك ممتد الآن حتى ${dayText(e.endDate)}`,
      details,
      entity: { type: 'contract', id: e.contractId },
      link: '/dashboard/profile',
      to: Audience.employee(e.employeeId),
      exclude: [e.actorUserId],
      dedupeKey: `contract_renewed:${e.contractId}:${dayKey(e.endDate)}`,
    });
  }

  @OnEvent('attendance.punch_changed', EVENT)
  async onPunchChanged(
    e: DomainEventMap['attendance.punch_changed'],
  ): Promise<void> {
    const { zone } = await this.lookup.locale(e.tenantId);
    const label = PUNCH_TYPE_LABELS_AR[e.punchType as PunchType] ?? e.punchType;
    const isLeave = e.punchType === (PunchType.LEAVE as string);
    const when = isLeave
      ? formatDate(e.punchTime, zone)
      : formatDateTime(e.punchTime, zone);

    const details: NotificationDetail[] = [{ label: 'النوع', value: label }];
    if (e.previousPunchTime) {
      details.push({
        label: 'الوقت السابق',
        value: new Date(e.previousPunchTime).toISOString(),
        format: 'datetime',
      });
    }
    details.push({
      label: e.previousPunchTime ? 'الوقت الجديد' : 'الوقت',
      value: new Date(e.punchTime).toISOString(),
      format: 'datetime',
    });
    if (e.leaveReason) details.push({ label: 'السبب', value: e.leaveReason });
    if (e.byName) details.push({ label: 'بواسطة', value: e.byName });

    await this.notifier.notifySafe({
      tenantId: e.tenantId,
      type: 'attendance_change',
      severity: e.change === 'edited' ? 'warning' : 'info',
      title:
        e.change === 'edited'
          ? 'عُدّلت بصمة حضور لك'
          : isLeave
            ? 'سُجّلت لك إجازة'
            : 'سُجّلت لك بصمة يدوية',
      body:
        e.change === 'edited'
          ? `بصمة «${label}» صارت ${when}${e.byName ? ` — بواسطة ${e.byName}` : ''}`
          : `«${label}» بتاريخ ${when}${e.leaveReason ? ` — السبب: ${e.leaveReason}` : ''}`,
      details,
      entity: { type: 'attendance_log', id: e.logId },
      link: '/dashboard/profile',
      to: Audience.employee(e.employeeId),
      exclude: [e.actorUserId],
    });
  }
}
