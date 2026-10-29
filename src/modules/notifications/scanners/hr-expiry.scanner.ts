// src/modules/notifications/scanners/hr-expiry.scanner.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PERMS } from '../../../common/constants/permissions';
import { dayKeyInZone } from '../../../common/utils/timezone.util';
import type { NotificationDetail } from '../entities/notification.entity';
import { Audience } from '../notification-audience.service';
import {
  dayText,
  employeeDetail,
  type EmployeeRef,
  NotificationLookupService,
} from '../notification-lookup.service';
import type { NotificationType } from '../notification-types';
import { NotifierService } from '../notifier.service';
import {
  daysBetweenKeys,
  type NotificationScanner,
  scanAllTenants,
  stageOf,
  whenText,
} from './scanner.util';

/** مراحل التنبيه قبل الانتهاء (بالأيام)، وكم يوماً يُنبَّه بعده */
const CONTRACT_STAGES = [30, 14, 7, 3, 1, 0];
const IQAMA_STAGES = [30, 14, 7, 3, 1, 0];
const PROBATION_STAGES = [14, 7, 1];
const EXPIRED_GRACE_DAYS = 7;

interface DueRow extends EmployeeRef {
  /** العقد (لتنبيهات العقد والتجربة) */
  contractId: string | null;
  /** YYYY-MM-DD */
  due: string;
}

interface Subject {
  type: NotificationType;
  stages: number[];
  grace: number | null;
  /** تنبيه الموظف نفسه أيضاً (فترة التجربة قرار إداري فلا) */
  toEmployee: boolean;
  /** من يتصرف: صلاحية التجديد */
  permission: string;
  noun: { own: string; of: (name: string) => string };
  verb: { future: string; past: string };
  entity: (row: DueRow) => { type: string; id: string };
  link: (row: DueRow) => string;
}

const SUBJECTS: Record<'contract' | 'iqama' | 'probation', Subject> = {
  contract: {
    type: 'contract_expiry',
    stages: CONTRACT_STAGES,
    grace: EXPIRED_GRACE_DAYS,
    toEmployee: true,
    permission: PERMS.CONTRACT_UPDATE.name,
    noun: { own: 'عقدك', of: (name) => `عقد ${name}` },
    verb: { future: 'ينتهي', past: 'انتهى' },
    entity: (row) => ({ type: 'contract', id: row.contractId ?? row.id }),
    link: () => '/dashboard/contracts',
  },
  iqama: {
    type: 'iqama_expiry',
    stages: IQAMA_STAGES,
    grace: EXPIRED_GRACE_DAYS,
    toEmployee: true,
    permission: PERMS.EMPLOYEE_UPDATE.name,
    noun: { own: 'إقامتك', of: (name) => `إقامة ${name}` },
    verb: { future: 'تنتهي', past: 'انتهت' },
    entity: (row) => ({ type: 'employee', id: row.id }),
    link: (row) => `/dashboard/employees/${row.id}`,
  },
  probation: {
    type: 'probation_end',
    stages: PROBATION_STAGES,
    grace: null,
    toEmployee: false,
    permission: PERMS.CONTRACT_UPDATE.name,
    noun: { own: 'فترة تجربتك', of: (name) => `فترة تجربة ${name}` },
    verb: { future: 'تنتهي', past: 'انتهت' },
    entity: (row) => ({ type: 'contract', id: row.contractId ?? row.id }),
    link: (row) => `/dashboard/employees/${row.id}`,
  },
};

/** أعمدة الموظف المشتركة في الاستعلامات */
const EMPLOYEE_COLUMNS = `e.id, e."fullName", e."employeeCode",
  e.branch_id AS "branchId", e.user_id AS "userId"`;
const ACTIVE_EMPLOYEE = `e.tenant_id = $1 AND e."deletedAt" IS NULL AND e.status = 'active'`;

/**
 * انتهاء العقود والإقامات وفترات التجربة: تنبيه عند كل مرحلة (30، 14، 7، 3،
 * 1 يوم، ثم «انتهى»)، للموظف ولمن يجدد. المفتاح يحمل تاريخ الانتهاء: التجديد
 * يغيّر التاريخ فتبدأ مراحل جديدة، ولا تكرار لنفس المرحلة أبداً.
 */
@Injectable()
export class HrExpiryScanner implements NotificationScanner {
  readonly label = 'تنبيهات انتهاء العقود والإقامات';
  private readonly logger = new Logger(HrExpiryScanner.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifier: NotifierService,
    private readonly lookup: NotificationLookupService,
  ) {}

  /** كل 6 ساعات: يلتقط "اليوم" الجديد لكل شركة بمنطقتها، والمفاتيح تمنع التكرار */
  @Cron('0 15 */6 * * *')
  run(): Promise<void> {
    return scanAllTenants(this.dataSource, this, this.logger);
  }

  async scanTenant(tenantId: string, now = new Date()): Promise<void> {
    const { zone } = await this.lookup.locale(tenantId);
    const today = dayKeyInZone(now, zone);
    const contracts = await this.dataSource.query<DueRow[]>(
      `SELECT ${EMPLOYEE_COLUMNS}, c.id AS "contractId", c."endDate"::text AS due
         FROM employee_contracts c JOIN employees e ON e.id = c.employee_id
        WHERE ${ACTIVE_EMPLOYEE} AND c."endDate" IS NOT NULL
          AND c."endDate" BETWEEN $2::date - $3::int AND $2::date + $4::int`,
      [tenantId, today, EXPIRED_GRACE_DAYS, CONTRACT_STAGES[0]],
    );
    const iqamas = await this.dataSource.query<DueRow[]>(
      `SELECT ${EMPLOYEE_COLUMNS}, NULL AS "contractId", e."iqamaExpiryDate"::text AS due
         FROM employees e
        WHERE ${ACTIVE_EMPLOYEE} AND e."iqamaExpiryDate" IS NOT NULL
          AND e."iqamaExpiryDate" BETWEEN $2::date - $3::int AND $2::date + $4::int`,
      [tenantId, today, EXPIRED_GRACE_DAYS, IQAMA_STAGES[0]],
    );
    const probations = await this.dataSource.query<DueRow[]>(
      `SELECT ${EMPLOYEE_COLUMNS}, c.id AS "contractId", c."probationEndDate"::text AS due
         FROM employee_contracts c JOIN employees e ON e.id = c.employee_id
        WHERE ${ACTIVE_EMPLOYEE} AND c."probationEndDate" IS NOT NULL
          AND c."probationEndDate" BETWEEN $2::date AND $2::date + $3::int`,
      [tenantId, today, PROBATION_STAGES[0]],
    );

    for (const row of contracts) {
      await this.alert(tenantId, SUBJECTS.contract, row, today);
    }
    for (const row of iqamas) {
      await this.alert(tenantId, SUBJECTS.iqama, row, today);
    }
    for (const row of probations) {
      await this.alert(tenantId, SUBJECTS.probation, row, today);
    }
  }

  private async alert(
    tenantId: string,
    subject: Subject,
    row: DueRow,
    today: string,
  ): Promise<void> {
    const daysLeft = daysBetweenKeys(today, row.due);
    const stage = stageOf(daysLeft, subject.stages, subject.grace);
    if (stage === null) return;

    const expired = stage === 'expired';
    const severity = expired || daysLeft <= 7 ? 'danger' : 'warning';
    const verb = expired ? subject.verb.past : subject.verb.future;
    const when = whenText(daysLeft);
    const key = `${subject.type}:${row.id}:${row.due}:${stage}`;
    const details: NotificationDetail[] = [
      employeeDetail(row),
      {
        label: expired ? 'تاريخ الانتهاء' : 'ينتهي في',
        value: row.due,
        format: 'date',
      },
      {
        label: expired ? 'مضى' : 'المتبقي',
        value: daysLeft === 0 ? 'اليوم' : `${Math.abs(daysLeft)} يوم`,
      },
    ];
    const base = {
      tenantId,
      type: subject.type,
      severity,
      details,
      data: { dueDate: row.due, stage },
      entity: subject.entity(row),
    } as const;

    await this.notifier.notifySafe({
      ...base,
      title: `${subject.noun.of(row.fullName)} ${verb} ${when}`,
      body: `${subject.noun.of(`${row.fullName} (${row.employeeCode})`)} ${verb} ${when} (${dayText(row.due)})${expired ? '' : ' — يحتاج إجراءً'}`,
      link: subject.link(row),
      to: Audience.can(subject.permission, row.branchId),
      // الموظف يصله تنبيهه الخاص بصيغة المخاطَب
      exclude: subject.toEmployee ? [row.userId] : [],
      dedupeKey: `${key}:hr`,
    });

    if (subject.toEmployee && row.userId) {
      await this.notifier.notifySafe({
        ...base,
        title: `${subject.noun.own} ${verb} ${when}`,
        body: `${subject.noun.own} ${verb} ${when} (${dayText(row.due)})${expired ? '' : ' — تواصل مع الموارد البشرية للتجديد'}`,
        link: '/dashboard/profile',
        to: Audience.users(row.userId),
        dedupeKey: `${key}:employee`,
      });
    }
  }
}
