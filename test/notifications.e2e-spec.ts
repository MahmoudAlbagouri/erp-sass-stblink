import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { DomainEvents } from '../src/common/events/domain-events';
import type { JwtPayload } from '../src/common/types/auth.types';
import { getJwtAccessSecret } from '../src/config/jwt.config';
import type { InboxItem } from '../src/modules/notifications/notification-view';
import { NotifierService } from '../src/modules/notifications/notifier.service';
import { Audience } from '../src/modules/notifications/notification-audience.service';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

interface Page<T> {
  data: T[];
  total: number;
  unread?: number;
}

/**
 * مركز الإشعارات عبر HTTP: رسائل الإدارة وقيودها، صندوق المستخدم، البث
 * اللحظي، ووصول أحداث الموديولات للمستمعات داخل التطبيق الحقيقي.
 */
describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;
  let sequence = 0;
  const jwt = new JwtService();

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

  /** مستخدم حقيقي في الجدول (الرسائل تشير لمرسلها) مع توكنه */
  const createUser = async (options: {
    superAdmin?: boolean;
    permissions?: string[];
    employee?: boolean;
  }): Promise<{ id: string; token: string; employeeId: string | null }> => {
    sequence += 1;
    // الدور في القاعدة أيضاً: المستلمون يُحدَّدون منها لا من التوكن
    let roleId: string | null = null;
    if (options.permissions) {
      roleId = (
        await dataSource.query<{ id: string }[]>(
          `INSERT INTO roles (name, tenant_id) VALUES ($1, $2) RETURNING id`,
          [`دور ${sequence}`, tenant.tenantId],
        )
      )[0].id;
      for (const name of options.permissions) {
        const [permission] = await dataSource.query<{ id: string }[]>(
          `INSERT INTO permissions (name) VALUES ($1)
           ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
          [name],
        );
        await dataSource.query(
          `INSERT INTO roles_permissions_permissions ("rolesId", "permissionsId")
           VALUES ($1, $2)`,
          [roleId, permission.id],
        );
      }
    }
    const id = (
      await dataSource.query<{ id: string }[]>(
        `INSERT INTO users (username, email, password, tenant_id, "isSuperAdmin", role_id)
         VALUES ($1, $2, 'x', $3, $4, $5) RETURNING id`,
        [
          `مستخدم ${sequence}`,
          `n${sequence}-${randomUUID()}@test.local`,
          tenant.tenantId,
          options.superAdmin ?? false,
          roleId,
        ],
      )
    )[0].id;
    let employeeId: string | null = null;
    if (options.employee) {
      employeeId = (
        await dataSource.query<{ id: string }[]>(
          `INSERT INTO employees ("fullName", "employeeCode", tenant_id, user_id)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [
            `موظف ${sequence}`,
            `N${sequence}-${Date.now()}`,
            tenant.tenantId,
            id,
          ],
        )
      )[0].id;
    }
    const payload: JwtPayload = {
      sub: id,
      tenantId: tenant.tenantId,
      isSuperAdmin: options.superAdmin ?? false,
      isSystemAdmin: false,
      isDisclaimerAccepted: true,
      role: options.permissions
        ? {
            id: 'role',
            name: 'دور',
            permissions: options.permissions.map((name) => ({ name })),
          }
        : undefined,
    };
    const token = jwt.sign(payload, {
      secret: getJwtAccessSecret(),
      expiresIn: '15m',
    });
    return { id, token, employeeId };
  };

  const inbox = async (token: string) =>
    data<Page<InboxItem>>(
      await api().get('/notifications').set(auth(token)).expect(200),
    );

  /** المستمعات تعمل بعد الحدث: ننتظر حتى يظهر الإشعار */
  const eventually = async <T>(
    read: () => Promise<T>,
    done: (value: T) => boolean,
  ): Promise<T> => {
    for (let i = 0; i < 40; i++) {
      const value = await read();
      if (done(value)) return value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return read();
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    tenant = await createTenantFixture(dataSource);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('registers the scheduler once, so no periodic job runs twice', () => {
    const schedulers = [...app.get(ModulesContainer).values()].filter(
      (module) => module.metatype === ScheduleModule,
    );
    expect(schedulers).toHaveLength(1);
  });

  it('turns a module event into a notification for whoever can act on it', async () => {
    const approver = await createUser({
      permissions: ['view_notifications', 'approve_resignation'],
    });
    const employee = await createUser({
      permissions: ['view_notifications'],
      employee: true,
    });

    app.get(DomainEvents).emit('resignation.submitted', {
      tenantId: tenant.tenantId,
      actorUserId: employee.id,
      requestId: randomUUID(),
      employeeId: employee.employeeId!,
      lastWorkingDay: '2026-12-31',
      reason: 'فرصة أخرى',
    });

    const list = await eventually(
      () => inbox(approver.token),
      (page) => page.total > 0,
    );
    expect(list.data[0]).toMatchObject({
      type: 'resignation_request',
      group: 'requests',
      severity: 'warning',
      link: '/dashboard/resignations',
    });
    expect(list.data[0].details).toEqual(
      expect.arrayContaining([{ label: 'السبب', value: 'فرصة أخرى' }]),
    );
    // من قدّم الطلب لا يُشعَر بطلبه
    expect((await inbox(employee.token)).total).toBe(0);
  });

  it('sends a management message and tracks who read and acknowledged it', async () => {
    const manager = await createUser({ superAdmin: true });
    const reader = await createUser({
      permissions: ['view_notifications'],
      employee: true,
    });
    const noLogin = (
      await dataSource.query<{ id: string }[]>(
        `INSERT INTO employees ("fullName", "employeeCode", tenant_id)
         VALUES ('بلا حساب', $1, $2) RETURNING id`,
        [`NL-${Date.now()}`, tenant.tenantId],
      )
    )[0].id;
    const audience = { kind: 'employees', ids: [reader.employeeId, noLogin] };

    const preview = data<{
      recipients: number;
      withoutAccount: { count: number };
    }>(
      await api()
        .post('/notifications/messages/preview')
        .set(auth(manager.token))
        .send({ audience })
        .expect(201),
    );
    expect(preview).toMatchObject({
      recipients: 1,
      withoutAccount: { count: 1 },
    });

    const sent = data<{ id: string; recipients: number }>(
      await api()
        .post('/notifications/messages')
        .set(auth(manager.token))
        .send({
          title: 'اجتماع الأحد',
          body: 'الساعة العاشرة في القاعة الكبرى',
          severity: 'warning',
          requiresAck: true,
          audience,
        })
        .expect(201),
    );
    expect(sent.recipients).toBe(1);

    const received = await inbox(reader.token);
    expect(received.unread).toBe(1);
    expect(received.data[0]).toMatchObject({
      type: 'manager_message',
      title: 'اجتماع الأحد',
      requiresAck: true,
      sender: { id: manager.id },
    });

    await api()
      .post(`/notifications/${sent.id}/ack`)
      .set(auth(reader.token))
      .expect(201);

    const history = data<
      Page<{ id: string; read: number; acknowledged: number }>
    >(
      await api()
        .get('/notifications/messages')
        .set(auth(manager.token))
        .expect(200),
    );
    expect(history.data[0]).toMatchObject({
      id: sent.id,
      read: 1,
      acknowledged: 1,
    });
  });

  it('keeps company-wide messages to holders of the broadcast permission', async () => {
    const sender = await createUser({
      permissions: ['create_notification'],
    });
    const toAll = { title: 'للجميع', body: '—', audience: { kind: 'all' } };
    await api()
      .post('/notifications/messages/broadcast')
      .set(auth(sender.token))
      .send(toAll)
      .expect(403);
    // ولا يمر الجمهور الجماعي من مسار الرسائل المباشرة
    await api()
      .post('/notifications/messages')
      .set(auth(sender.token))
      .send(toAll)
      .expect(400);
  });

  it('streams a new notification to an open connection immediately', async () => {
    const user = await createUser({ permissions: ['view_notifications'] });
    await app.listen(0);
    const { port } = (
      app.getHttpServer() as unknown as Server
    ).address() as AddressInfo;
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/notifications/stream`, {
      headers: auth(user.token),
      signal: controller.signal,
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    await app.get(NotifierService).notify({
      tenantId: tenant.tenantId,
      type: 'general',
      title: 'لحظي',
      body: '—',
      to: Audience.users(user.id),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    while (!received.includes('event: notification')) {
      const { value, done } = await reader.read();
      if (done) break;
      received += decoder.decode(value);
    }
    controller.abort();
    expect(received).toContain('event: notification');
    expect(received).toContain('"title":"لحظي"');
  });
});
