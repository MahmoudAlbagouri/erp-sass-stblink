import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { NotificationPreference } from '../src/modules/notifications/entities/notification-preference.entity';
import {
  Audience,
  NotificationAudienceService,
} from '../src/modules/notifications/notification-audience.service';
import { NotificationLookupService } from '../src/modules/notifications/notification-lookup.service';
import { NotificationPreferencesService } from '../src/modules/notifications/notification-preferences.service';
import { NotificationStreamService } from '../src/modules/notifications/notification-stream.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { NotifierService } from '../src/modules/notifications/notifier.service';
import { AccountingErrorsScanner } from '../src/modules/notifications/scanners/accounting-errors.scanner';
import { AlertStatesService } from '../src/modules/notifications/scanners/alert-states.service';
import { AttendanceDevicesScanner } from '../src/modules/notifications/scanners/attendance-devices.scanner';
import { HrExpiryScanner } from '../src/modules/notifications/scanners/hr-expiry.scanner';
import { InvoicesDueScanner } from '../src/modules/notifications/scanners/invoices-due.scanner';
import { LowStockScanner } from '../src/modules/notifications/scanners/low-stock.scanner';
import { NotificationChecksService } from '../src/modules/notifications/scanners/notification-checks.service';
import {
  stageOf,
  whenText,
} from '../src/modules/notifications/scanners/scanner.util';
import { SubscriptionExpiryScanner } from '../src/modules/notifications/scanners/subscription-expiry.scanner';
import { Tenant } from '../src/modules/tenants/entities/tenant.entity';
import { createTestDataSource, truncateAllTables } from './utils/test-database';

/**
 * مركز الإشعارات: المدخل الواحد (notify) لا يكرر أبداً، يصل لمن يملك التصرف
 * داخل شركته وفروعه فقط، يحترم الكتم، والفحوص الدورية تنبّه مرة لكل مرحلة.
 */
describe('Notifications (integration)', () => {
  let dataSource: DataSource;
  let stream: NotificationStreamService;
  let notifier: NotifierService;
  let inbox: NotificationsService;
  let preferences: NotificationPreferencesService;
  let alerts: AlertStatesService;
  let hrExpiry: HrExpiryScanner;
  let devices: AttendanceDevicesScanner;
  let checks: NotificationChecksService;

  let tenantId: string;
  let otherTenantId: string;
  let sequence = 0;

  const DAY = 24 * 60 * 60 * 1000;
  /** ظهر يوم في الرياض: "اليوم" لا يلتبس بحدود المنطقة */
  const NOW = new Date('2026-10-01T09:00:00Z');
  const dayAfter = (days: number) =>
    new Date(NOW.getTime() + days * DAY).toISOString().slice(0, 10);

  const permissionId = async (name: string): Promise<string> =>
    (
      await dataSource.query<{ id: string }[]>(
        `INSERT INTO permissions (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [name],
      )
    )[0].id;

  const createUser = async (
    tenant: string,
    options: {
      permissions?: string[];
      superAdmin?: boolean;
      branchIds?: string[];
      status?: string;
    } = {},
  ): Promise<string> => {
    sequence += 1;
    let roleId: string | null = null;
    if (options.permissions?.length) {
      roleId = (
        await dataSource.query<{ id: string }[]>(
          `INSERT INTO roles (name, tenant_id) VALUES ($1, $2) RETURNING id`,
          [`دور ${sequence}`, tenant],
        )
      )[0].id;
      for (const name of options.permissions) {
        await dataSource.query(
          `INSERT INTO roles_permissions_permissions ("rolesId", "permissionsId") VALUES ($1, $2)`,
          [roleId, await permissionId(name)],
        );
      }
    }
    const id = (
      await dataSource.query<{ id: string }[]>(
        `INSERT INTO users (username, email, password, tenant_id, role_id, "isSuperAdmin", status)
         VALUES ($1, $2, 'x', $3, $4, $5, $6) RETURNING id`,
        [
          `مستخدم ${sequence}`,
          `user${sequence}-${randomUUID()}@test.local`,
          tenant,
          roleId,
          options.superAdmin ?? false,
          options.status ?? 'active',
        ],
      )
    )[0].id;
    for (const branchId of options.branchIds ?? []) {
      await dataSource.query(
        `INSERT INTO user_branches (user_id, branch_id) VALUES ($1, $2)`,
        [id, branchId],
      );
    }
    return id;
  };

  const createBranch = async (tenant: string, name: string): Promise<string> =>
    (
      await dataSource.query<{ id: string }[]>(
        `INSERT INTO branches ("tenantId", name) VALUES ($1, $2) RETURNING id`,
        [tenant, name],
      )
    )[0].id;

  const createEmployee = async (
    tenant: string,
    fields: {
      userId?: string | null;
      branchId?: string | null;
      iqamaExpiryDate?: string | null;
    } = {},
  ): Promise<string> => {
    sequence += 1;
    return (
      await dataSource.query<{ id: string }[]>(
        `INSERT INTO employees ("fullName", "employeeCode", tenant_id, user_id, branch_id, "iqamaExpiryDate")
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          `موظف ${sequence}`,
          `E${sequence}-${Date.now()}`,
          tenant,
          fields.userId ?? null,
          fields.branchId ?? null,
          fields.iqamaExpiryDate ?? null,
        ],
      )
    )[0].id;
  };

  const inboxOf = (userId: string) => inbox.list(userId, { limit: 50 });

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    stream = new NotificationStreamService();
    const audience = new NotificationAudienceService(dataSource);
    const lookup = new NotificationLookupService(dataSource);
    notifier = new NotifierService(dataSource, audience, stream);
    inbox = new NotificationsService(dataSource, stream);
    preferences = new NotificationPreferencesService(
      dataSource.getRepository(NotificationPreference),
    );
    alerts = new AlertStatesService(dataSource);
    hrExpiry = new HrExpiryScanner(dataSource, notifier, lookup);
    devices = new AttendanceDevicesScanner(dataSource, notifier);
    checks = new NotificationChecksService(
      hrExpiry,
      new SubscriptionExpiryScanner(dataSource, notifier, lookup),
      new LowStockScanner(dataSource, notifier, alerts),
      devices,
      new AccountingErrorsScanner(dataSource, notifier, alerts),
      new InvoicesDueScanner(dataSource, notifier, lookup, alerts),
    );
  });

  afterAll(async () => {
    stream?.onModuleDestroy();
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    const tenants = dataSource.getRepository(Tenant);
    tenantId = (
      await tenants.save({
        companyName: 'شركة الإشعارات',
        country: 'SA',
        currency: 'SAR',
        timezone: 'Asia/Riyadh',
      })
    ).id;
    otherTenantId = (await tenants.save({ companyName: 'شركة أخرى' })).id;
  });

  // ══════════════════════════ منع التكرار ══════════════════════════

  it('creates a dedupe key once, even when two runs race for it', async () => {
    const user = await createUser(tenantId);
    const send = () =>
      notifier.notify({
        tenantId,
        type: 'general',
        title: 'مرة واحدة',
        body: '—',
        to: Audience.users(user),
        dedupeKey: 'race:1',
      });

    const results = await Promise.all([send(), send(), send()]);

    expect(results.filter((r) => r.id).length).toBe(1);
    expect(results.filter((r) => r.duplicate).length).toBe(2);
    expect((await inboxOf(user)).total).toBe(1);
  });

  // ══════════════════════════ المستلمون ══════════════════════════

  it('reaches whoever holds the permission, within the event branch and company', async () => {
    const riyadh = await createBranch(tenantId, 'الرياض');
    const jeddah = await createBranch(tenantId, 'جدة');
    const admin = await createUser(tenantId, { superAdmin: true });
    const anyBranchHr = await createUser(tenantId, {
      permissions: ['approve_leave'],
    });
    const riyadhHr = await createUser(tenantId, {
      permissions: ['approve_leave'],
      branchIds: [riyadh],
    });
    const jeddahHr = await createUser(tenantId, {
      permissions: ['approve_leave'],
      branchIds: [jeddah],
    });
    const suspendedHr = await createUser(tenantId, {
      permissions: ['approve_leave'],
      status: 'suspended',
    });
    const noPermission = await createUser(tenantId, {
      permissions: ['view_leaves'],
    });
    const otherCompanyHr = await createUser(otherTenantId, {
      permissions: ['approve_leave'],
    });

    const result = await notifier.notify({
      tenantId,
      type: 'leave_request',
      title: 'طلب إجازة',
      body: '—',
      to: Audience.can('approve_leave', riyadh),
      exclude: [anyBranchHr],
    });

    expect(result.recipients).toBe(2);
    for (const user of [admin, riyadhHr]) {
      expect((await inboxOf(user)).total).toBe(1);
    }
    for (const user of [
      anyBranchHr,
      jeddahHr,
      suspendedHr,
      noPermission,
      otherCompanyHr,
    ]) {
      expect((await inboxOf(user)).total).toBe(0);
    }
  });

  it('skips employees without a login and never crosses companies', async () => {
    const withLogin = await createUser(tenantId);
    const employee = await createEmployee(tenantId, { userId: withLogin });
    const withoutLogin = await createEmployee(tenantId);
    const foreignUser = await createUser(otherTenantId);
    const foreignEmployee = await createEmployee(otherTenantId, {
      userId: foreignUser,
    });

    const result = await notifier.notify({
      tenantId,
      type: 'manager_message',
      title: 'رسالة',
      body: '—',
      to: Audience.employees([employee, withoutLogin, foreignEmployee]),
    });

    expect(result.recipients).toBe(1);
    expect((await inboxOf(foreignUser)).total).toBe(0);
  });

  it('respects muted types, but never mutes management messages', async () => {
    const user = await createUser(tenantId);
    await preferences.update(user, ['low_stock']);
    await expect(preferences.update(user, ['manager_message'])).rejects.toThrow(
      'لا يمكن كتم',
    );

    const muted = await notifier.notify({
      tenantId,
      type: 'low_stock',
      title: 'نقص',
      body: '—',
      to: Audience.users(user),
    });
    const message = await notifier.notify({
      tenantId,
      type: 'manager_message',
      title: 'اجتماع',
      body: '—',
      to: Audience.users(user),
    });

    expect(muted.recipients).toBe(0);
    expect(message.recipients).toBe(1);
  });

  // ══════════════════════════ صندوق المستخدم ══════════════════════════

  it('tracks read, acknowledged and hidden per recipient', async () => {
    const [a, b] = [await createUser(tenantId), await createUser(tenantId)];
    const { id } = await notifier.notify({
      tenantId,
      type: 'manager_message',
      title: 'سياسة جديدة',
      body: 'اقرأها وأكّد',
      to: Audience.users(a, b),
      requiresAck: true,
    });

    expect((await inbox.unreadCount(a)).count).toBe(1);
    expect((await inbox.unreadCount(a)).byGroup).toEqual({ messages: 1 });

    await inbox.acknowledge(a, id!);
    const item = await inbox.findOne(a, id!);
    expect(item.readAt).not.toBeNull();
    expect(item.acknowledgedAt).not.toBeNull();
    expect((await inbox.unreadCount(b)).count).toBe(1);

    await inbox.hide(a, id!);
    expect((await inboxOf(a)).total).toBe(0);
    expect((await inboxOf(b)).total).toBe(1);

    await inbox.markAllRead(b);
    expect((await inbox.list(b, { unread: true })).total).toBe(0);
  });

  // ══════════════════════════ الفحوص الدورية ══════════════════════════

  it('alerts each expiry stage once, and starts over when the date is renewed', async () => {
    const hrUser = await createUser(tenantId, {
      permissions: ['update_employee'],
    });
    const self = await createUser(tenantId);
    const employee = await createEmployee(tenantId, {
      userId: self,
      iqamaExpiryDate: dayAfter(25),
    });

    await hrExpiry.scanTenant(tenantId, NOW);
    await hrExpiry.scanTenant(tenantId, NOW);

    const hrInbox = await inboxOf(hrUser);
    expect(hrInbox.total).toBe(1);
    expect(hrInbox.data[0]).toMatchObject({
      type: 'iqama_expiry',
      severity: 'warning',
      data: { dueDate: dayAfter(25), stage: 30 },
    });
    expect(hrInbox.data[0].title).toContain('خلال 25 يوماً');
    const own = await inboxOf(self);
    expect(own.total).toBe(1);
    expect(own.data[0].title).toBe('إقامتك تنتهي خلال 25 يوماً');

    // 11 يوماً بعد: مرحلة 14 — تنبيه جديد واحد
    await hrExpiry.scanTenant(tenantId, new Date(NOW.getTime() + 11 * DAY));
    expect((await inboxOf(hrUser)).total).toBe(2);

    // تجديد الإقامة لتاريخ جديد قريب: مراحله تبدأ من جديد
    await dataSource.query(
      `UPDATE employees SET "iqamaExpiryDate" = $1 WHERE id = $2`,
      [dayAfter(20), employee],
    );
    await hrExpiry.scanTenant(tenantId, NOW);
    expect((await inboxOf(hrUser)).total).toBe(3);
  });

  it('alerts a disconnected attendance device once per outage', async () => {
    const itUser = await createUser(tenantId, {
      permissions: ['update_biometric_device'],
    });
    const lastSeen = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await dataSource.query(
      `INSERT INTO biometric_devices ("serialNumber", alias, tenant_id, last_seen_at)
       VALUES ($1, 'بوابة المدخل', $2, $3)`,
      [`SN-${randomUUID()}`, tenantId, lastSeen],
    );

    await devices.scanTenant(tenantId);
    await devices.scanTenant(tenantId);

    const list = await inboxOf(itUser);
    expect(list.total).toBe(1);
    expect(list.data[0].title).toContain('بوابة المدخل');
  });

  it('raises a standing alert once, clears it, and raises again if it returns', async () => {
    expect(await alerts.sync(tenantId, 'x:', ['x:1', 'x:2'])).toEqual(
      expect.arrayContaining(['x:1', 'x:2']),
    );
    expect(await alerts.sync(tenantId, 'x:', ['x:1', 'x:2'])).toEqual([]);
    // x:1 زال (رُفع الرصيد)، ثم عاد
    expect(await alerts.sync(tenantId, 'x:', ['x:2'])).toEqual([]);
    expect(await alerts.sync(tenantId, 'x:', ['x:1', 'x:2'])).toEqual(['x:1']);
  });

  it('runs every periodic check against the real schema without errors', async () => {
    const result = await checks.runForTenant(tenantId);
    expect(result.failed).toEqual([]);
    expect(result.ran).toHaveLength(6);
  });

  it('words stages and remaining days naturally', () => {
    expect(stageOf(25, [30, 14, 7, 3, 1, 0], 7)).toBe(30);
    expect(stageOf(7, [30, 14, 7, 3, 1, 0], 7)).toBe(7);
    expect(stageOf(0, [30, 14, 7, 3, 1, 0], 7)).toBe(0);
    expect(stageOf(-3, [30, 14, 7, 3, 1, 0], 7)).toBe('expired');
    expect(stageOf(-30, [30, 14, 7, 3, 1, 0], 7)).toBeNull();
    expect(stageOf(45, [30, 14, 7, 3, 1, 0], 7)).toBeNull();
    expect(whenText(0)).toBe('اليوم');
    expect(whenText(1)).toBe('غداً');
    expect(whenText(2)).toBe('خلال يومين');
    expect(whenText(5)).toBe('خلال 5 أيام');
    expect(whenText(25)).toBe('خلال 25 يوماً');
    expect(whenText(-2)).toBe('منذ يومين');
  });
});
