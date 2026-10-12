import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { SupportSession } from '../src/modules/auth/entities/support-session.entity';
import {
  createTenantFixture,
  systemOwnerToken,
  TenantFixture,
} from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * وضع الدعم: مالك النظام يدخل شركة ويعمل داخلها بصلاحيات مديرها — ولا شيء
 * أكثر: لا شركة أخرى، ولا صفحات إدارة النظام، ولا تجاوز لخطة الشركة.
 */
describe('Support mode (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;
  let owner: string;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

  const enter = (tenantId: string, token = owner) =>
    api().post(`/auth/support/${tenantId}`).set(auth(token));

  const supportToken = async (tenantId = tenant.tenantId) =>
    data<{ accessToken: string }>(await enter(tenantId)).accessToken;

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
    tenant = await createTenantFixture(dataSource, {
      features: ['products_module', 'inventory_module'],
    });
    owner = systemOwnerToken();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets the system owner work inside a company', async () => {
    const entered = await enter(tenant.tenantId);
    expect(entered.status).toBe(200);
    expect(data(entered)).toMatchObject({
      tenant: { id: tenant.tenantId },
      accessToken: expect.any(String) as unknown,
    });
    const token = data<{ accessToken: string }>(entered).accessToken;

    // قبل الدخول: مرفوض بوضوح. بعده: يعمل كمدير الشركة
    expect(
      (await api().get('/inventory/warehouses').set(auth(owner))).status,
    ).toBe(403);
    const created = await api()
      .post('/inventory/warehouses')
      .set(auth(token))
      .send({ name: 'فرع أضافه الدعم' });
    expect(created.status).toBe(201);

    // ما أضافه الدعم يراه مدير الشركة نفسه: نفس البيانات لا نسخة جانبية
    const seen = await api()
      .get('/inventory/warehouses')
      .set(auth(tenant.adminToken));
    expect(data<{ name: string }[]>(seen).map((w) => w.name)).toContain(
      'فرع أضافه الدعم',
    );
  });

  it('confines the support token to that one company', async () => {
    const other = await createTenantFixture(dataSource, {
      features: ['products_module', 'inventory_module'],
    });
    await api()
      .post('/inventory/warehouses')
      .set(auth(other.adminToken))
      .send({ name: 'مخزن الشركة الأخرى' });

    const token = await supportToken();
    const list = await api().get('/inventory/warehouses').set(auth(token));

    expect(data<{ name: string }[]>(list).map((w) => w.name)).not.toContain(
      'مخزن الشركة الأخرى',
    );
  });

  it('drops system-owner powers while inside a company', async () => {
    const token = await supportToken();

    // لا صفحات إدارة النظام، ولا دخول شركة أخرى بتوكن الدعم
    expect((await api().get('/tenants').set(auth(token))).status).toBe(403);
    expect((await enter(tenant.tenantId, token)).status).toBe(403);
    expect(
      (await api().get('/auth/support/sessions').set(auth(token))).status,
    ).toBe(403);
  });

  it('stays within the company plan like its own admin', async () => {
    const token = await supportToken();

    // خطة الشركة بلا موديول المبيعات: الدعم يرى ما يراه العميل
    expect((await api().get('/sales/invoices').set(auth(token))).status).toBe(
      403,
    );
    expect((await api().get('/catalog/products').set(auth(token))).status).toBe(
      200,
    );
  });

  it('is reserved for the system owner', async () => {
    const employee = tenant.tokenWith(['view_inventory']);

    expect((await enter(tenant.tenantId, tenant.adminToken)).status).toBe(403);
    expect((await enter(tenant.tenantId, employee)).status).toBe(403);
    expect((await api().post(`/auth/support/${tenant.tenantId}`)).status).toBe(
      401,
    );
  });

  it('rejects an unknown or malformed company id', async () => {
    expect((await enter(randomUUID())).status).toBe(404);
    expect((await enter('not-a-uuid')).status).toBe(400);
  });

  it('logs one session per visit, not one per token renewal', async () => {
    await enter(tenant.tenantId);
    await enter(tenant.tenantId); // تجديد التوكن أثناء العمل

    const sessions = await dataSource.getRepository(SupportSession).find();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ tenantId: tenant.tenantId });

    const log = await api().get('/auth/support/sessions').set(auth(owner));
    expect(log.status).toBe(200);
    expect(data<object[]>(log)).toHaveLength(1);
  });
});
