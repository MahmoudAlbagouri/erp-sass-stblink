import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * موديول المبيعات عبر الـ HTTP: الخطة وحدّ الفواتير، الصلاحيات (ومنها إخفاء
 * التكلفة والربح)، التحقق من المدخلات، ودورة كاملة حتى كشف الحساب.
 */
describe('Sales API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  const FEATURES = ['products_module', 'inventory_module', 'sales_module'];
  const TODAY = '2026-10-12';

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  // كل الردود تُغلَّف بـ TransformInterceptor: { success, data, ... }
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

  const get = (path: string, token = tenant.adminToken) =>
    api().get(path).set(auth(token));
  const post = (path: string, body: object = {}, token = tenant.adminToken) =>
    api().post(path).set(auth(token)).send(body);

  /** صنف له رصيد 50 بتكلفة 1 + عميل + المخزن الرئيسي */
  const setup = async () => {
    const units = data<{ id: string }[]>(await get('/catalog/units'));
    const product = await post('/catalog/products', {
      name: 'مياه 330 مل',
      baseUnitId: units[0].id,
      salePrice: 2.3,
    });
    const productId = data<{ id: string }>(product).id;
    const warehouses = data<{ id: string; type: string }[]>(
      await get('/inventory/warehouses'),
    );
    const warehouseId = warehouses.find((w) => w.type === 'main')!.id;
    await post('/inventory/adjustments', {
      warehouseId,
      type: 'opening',
      lines: [{ productId, quantity: 50, unitCost: 1 }],
    });
    const customer = await post('/sales/customers', { name: 'مطعم الريف' });

    return {
      productId,
      warehouseId,
      customerId: data<{ id: string }>(customer).id,
    };
  };

  const createDraft = async (
    ids: { productId: string; warehouseId: string; customerId?: string },
    token = tenant.adminToken,
  ) =>
    post(
      '/sales/invoices',
      {
        customerId: ids.customerId,
        warehouseId: ids.warehouseId,
        invoiceDate: TODAY,
        lines: [{ productId: ids.productId, quantity: 10, unitPrice: 2.3 }],
      },
      token,
    );

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
    tenant = await createTenantFixture(dataSource, { features: FEATURES });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('runs a full cycle: settings, invoice, issue, collect, return, statement', async () => {
    const ids = await setup();

    const settings = await api()
      .patch('/sales/settings')
      .set(auth(tenant.adminToken))
      .send({ sellerName: 'مؤسسة الأفق', taxNumber: '300000000000003' });
    expect(settings.status).toBe(200);

    const draft = await createDraft(ids);
    const created = data<{ id: string; lines: { id: string }[] }>(draft);
    expect(draft.status).toBe(201);
    expect(data(draft)).toMatchObject({
      number: null,
      status: 'draft',
      total: 23,
    });

    const issued = await post(`/sales/invoices/${created.id}/issue`, {
      payments: [{ method: 'cash', amount: 10 }],
    });
    expect(issued.status).toBe(200);
    expect(data(issued)).toMatchObject({
      number: 'INV-000001',
      status: 'issued',
      paymentStatus: 'partial',
      remaining: 13,
      costTotal: 10,
    });
    expect(data<{ qrCode: string }>(issued).qrCode).toEqual(expect.any(String));

    const collect = await post('/sales/payments', {
      invoiceId: created.id,
      paymentDate: TODAY,
      amount: 13,
      method: 'bank_transfer',
    });
    expect(collect.status).toBe(201);

    const ret = await post('/sales/returns', {
      invoiceId: created.id,
      returnDate: TODAY,
      lines: [{ invoiceLineId: created.lines[0].id, quantity: 5 }],
    });
    const retIssued = await post(
      `/sales/returns/${data<{ id: string }>(ret).id}/issue`,
      { refund: { method: 'cash', amount: 11.5 } },
    );
    expect(data(retIssued)).toMatchObject({
      number: 'CN-000001',
      refundedAmount: 11.5,
    });

    const stockLevels = data<{ data: { quantity: number }[] }>(
      await get('/inventory/stock'),
    );
    expect(stockLevels.data).toMatchObject([{ quantity: 45 }]);

    const statement = data<{ closingBalance: number; entries: unknown[] }>(
      await get(`/sales/customers/${ids.customerId}/statement`),
    );
    expect(statement.entries).toHaveLength(5);
    expect(statement.closingBalance).toBe(0);
  });

  it('rejects invalid input with 400', async () => {
    const ids = await setup();
    const invoice = (body: object) => post('/sales/invoices', body);
    const base = { warehouseId: ids.warehouseId, invoiceDate: TODAY };
    const line = { productId: ids.productId, quantity: 1, unitPrice: 2.3 };

    expect((await invoice({ ...base, lines: [] })).status).toBe(400);
    expect(
      (await invoice({ ...base, lines: [{ ...line, quantity: -1 }] })).status,
    ).toBe(400);
    expect(
      (await invoice({ ...base, uuid: 'not-a-uuid', lines: [line] })).status,
    ).toBe(400);
    // رقم الفاتورة ومبالغها يحددها السيرفر: لا تُقبل من العميل
    expect(
      (await invoice({ ...base, number: 'INV-999999', lines: [line] })).status,
    ).toBe(400);
    expect(
      (
        await api()
          .patch('/sales/settings')
          .set(auth(tenant.adminToken))
          .send({ taxNumber: '123' })
      ).status,
    ).toBe(400);

    const draft = data<{ id: string }>(await createDraft(ids));
    expect(
      (
        await post(`/sales/invoices/${draft.id}/issue`, {
          payments: [{ method: 'bitcoin', amount: 1 }],
        })
      ).status,
    ).toBe(400);
  });

  it('enforces the monthly invoice quota (max_invoices)', async () => {
    const limited = await createTenantFixture(dataSource, {
      features: FEATURES,
      quotas: { max_invoices: 1 },
    });
    tenant = limited;
    const ids = await setup();

    const first = data<{ id: string }>(await createDraft(ids));
    const second = data<{ id: string }>(await createDraft(ids));

    expect((await post(`/sales/invoices/${first.id}/issue`)).status).toBe(200);
    // المسودات لا تُحسب؛ الإصدار الثاني هو ما يتجاوز الحد
    expect((await post(`/sales/invoices/${second.id}/issue`)).status).toBe(403);
  });

  it('blocks the whole module when the plan lacks the feature', async () => {
    const noFeature = await createTenantFixture(dataSource, {
      features: ['products_module', 'inventory_module'],
    });

    expect((await get('/sales/invoices', noFeature.adminToken)).status).toBe(
      403,
    );
    expect((await get('/sales/customers', noFeature.adminToken)).status).toBe(
      403,
    );
  });

  it('checks permissions per action and hides cost from cashiers', async () => {
    const ids = await setup();
    const cashier = tenant.tokenWith([
      'view_sales',
      'manage_sales',
      'issue_sales',
    ]);

    const draft = data<{ id: string }>(await createDraft(ids, cashier));
    const issued = await post(`/sales/invoices/${draft.id}/issue`, {}, cashier);

    expect(issued.status).toBe(200);
    // الكاشير يبيع لكنه لا يرى تكلفة البضاعة ولا الربح
    expect(data(issued)).toMatchObject({ costTotal: 0 });
    expect(
      data<{ lines: { unitCost: number }[] }>(issued).lines[0].unitCost,
    ).toBe(0);
    expect(
      data<{ monthProfit: number | null }>(await get('/sales/summary', cashier))
        .monthProfit,
    ).toBeNull();
    expect(
      data<{ monthProfit: number | null }>(await get('/sales/summary'))
        .monthProfit,
    ).not.toBeNull();

    // ولا يسجّل مرتجعات ولا يعدّل إعدادات الفوترة ولا يضيف عملاء
    expect(
      (
        await post(
          '/sales/returns',
          { invoiceId: draft.id, returnDate: TODAY, lines: [] },
          cashier,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .patch('/sales/settings')
          .set(auth(cashier))
          .send({ sellerName: 'x' })
      ).status,
    ).toBe(403);
    expect(
      (await post('/sales/customers', { name: 'عميل' }, cashier)).status,
    ).toBe(403);
  });

  it('keeps tenants isolated over HTTP', async () => {
    const other = await createTenantFixture(dataSource, { features: FEATURES });
    const ids = await setup();
    const draft = data<{ id: string }>(await createDraft(ids));

    const list = await get('/sales/invoices', other.adminToken);
    const read = await get(`/sales/invoices/${draft.id}`, other.adminToken);
    const steal = await post(
      `/sales/invoices/${draft.id}/issue`,
      {},
      other.adminToken,
    );

    expect(data<{ total: number }>(list).total).toBe(0);
    expect(read.status).toBe(404);
    expect(steal.status).toBe(404);
  });
});
