import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * موديول المشتريات عبر الـ HTTP: الخطة، الصلاحيات، التحقق من المدخلات، ودورة
 * كاملة (مورد ← فاتورة ← اعتماد ← سداد ← مرتجع ← كشف حساب).
 */
describe('Purchasing API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  const FEATURES = ['products_module', 'inventory_module', 'purchasing_module'];
  const TODAY = '2026-10-12';

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  // كل الردود تُغلَّف بـ TransformInterceptor: { success, data, ... }
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

  const get = (path: string, token = tenant.adminToken) =>
    api().get(path).set(auth(token));
  const post = (path: string, body: object = {}, token = tenant.adminToken) =>
    api().post(path).set(auth(token)).send(body);

  /** صنف + مورد + المخزن الرئيسي: ما تحتاجه أي فاتورة */
  const setup = async () => {
    const units = data<{ id: string }[]>(await get('/catalog/units'));
    const product = await post('/catalog/products', {
      name: 'مياه 330 مل',
      baseUnitId: units[0].id,
      salePrice: 2,
    });
    const supplier = await post('/purchasing/suppliers', {
      name: 'مؤسسة التوريد',
      taxNumber: '300000000000003',
    });
    const warehouses = data<{ id: string; type: string }[]>(
      await get('/inventory/warehouses'),
    );

    return {
      productId: data<{ id: string }>(product).id,
      supplierId: data<{ id: string }>(supplier).id,
      warehouseId: warehouses.find((w) => w.type === 'main')!.id,
    };
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
    tenant = await createTenantFixture(dataSource, { features: FEATURES });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('runs a full cycle: invoice, post, pay, return, statement', async () => {
    const { productId, supplierId, warehouseId } = await setup();

    const invoice = await post('/purchasing/invoices', {
      supplierId,
      warehouseId,
      invoiceDate: TODAY,
      supplierReference: 'INV-778',
      lines: [{ productId, quantity: 100, unitPrice: 1.5 }],
    });
    const created = data<{ id: string; lines: { id: string }[] }>(invoice);
    expect(invoice.status).toBe(201);
    expect(data(invoice)).toMatchObject({
      number: 'PI-000001',
      status: 'draft',
      total: 172.5,
    });

    const posted = await post(`/purchasing/invoices/${created.id}/post`);
    expect(posted.status).toBe(200);

    const stockLevels = data<{ data: { quantity: number; avgCost: number }[] }>(
      await get('/inventory/stock'),
    );
    expect(stockLevels.data).toMatchObject([{ quantity: 100, avgCost: 1.5 }]);

    const payment = await post('/purchasing/payments', {
      supplierId,
      invoiceId: created.id,
      paymentDate: TODAY,
      amount: 100,
      method: 'bank_transfer',
    });
    expect(payment.status).toBe(201);

    const ret = await post('/purchasing/returns', {
      invoiceId: created.id,
      returnDate: TODAY,
      lines: [{ invoiceLineId: created.lines[0].id, quantity: 10 }],
    });
    expect(
      (await post(`/purchasing/returns/${data<{ id: string }>(ret).id}/post`))
        .status,
    ).toBe(200);

    const statement = data<{ closingBalance: number; entries: unknown[] }>(
      await get(`/purchasing/suppliers/${supplierId}/statement`),
    );
    expect(statement.entries).toHaveLength(3);
    expect(statement.closingBalance).toBe(55.25); // 172.5 − 100 − 17.25

    const summary = data<{ payables: number }>(
      await get('/purchasing/summary'),
    );
    expect(summary.payables).toBe(55.25);
  });

  it('rejects invalid input with 400', async () => {
    const { productId, supplierId, warehouseId } = await setup();
    const invoice = (body: object) => post('/purchasing/invoices', body);
    const base = { supplierId, warehouseId, invoiceDate: TODAY };

    expect((await invoice({ ...base, lines: [] })).status).toBe(400);
    expect(
      (
        await invoice({
          ...base,
          lines: [{ productId, quantity: 0, unitPrice: 1 }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await invoice({
          ...base,
          invoiceDate: '12/10/2026',
          lines: [{ productId, quantity: 1, unitPrice: 1 }],
        })
      ).status,
    ).toBe(400);
    // مبالغ الفاتورة يحسبها السيرفر: لا تُقبل من العميل
    expect(
      (
        await invoice({
          ...base,
          total: 1,
          lines: [{ productId, quantity: 1, unitPrice: 1 }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await post('/purchasing/suppliers', { name: 'x', taxNumber: '123' }))
        .status,
    ).toBe(400);
  });

  it('blocks the whole module when the plan lacks the feature', async () => {
    const noFeature = await createTenantFixture(dataSource, {
      features: ['products_module', 'inventory_module'],
    });

    expect(
      (await get('/purchasing/suppliers', noFeature.adminToken)).status,
    ).toBe(403);
    expect(
      (await get('/purchasing/invoices', noFeature.adminToken)).status,
    ).toBe(403);
  });

  it('checks permissions per action', async () => {
    const { productId, supplierId, warehouseId } = await setup();
    const clerk = tenant.tokenWith([
      'view_suppliers',
      'view_purchases',
      'manage_purchases',
    ]);

    const draft = await post(
      '/purchasing/invoices',
      {
        supplierId,
        warehouseId,
        invoiceDate: TODAY,
        lines: [{ productId, quantity: 1, unitPrice: 1 }],
      },
      clerk,
    );
    const invoiceId = data<{ id: string }>(draft).id;

    expect(draft.status).toBe(201);
    // من يُدخل الفواتير لا يعتمدها ولا يسدّد ولا يضيف موردين
    expect(
      (await post(`/purchasing/invoices/${invoiceId}/post`, {}, clerk)).status,
    ).toBe(403);
    expect(
      (
        await post(
          '/purchasing/payments',
          { supplierId, paymentDate: TODAY, amount: 1 },
          clerk,
        )
      ).status,
    ).toBe(403);
    expect(
      (await post('/purchasing/suppliers', { name: 'مورد' }, clerk)).status,
    ).toBe(403);
  });

  it('keeps tenants isolated over HTTP', async () => {
    const other = await createTenantFixture(dataSource, { features: FEATURES });
    const { productId, supplierId, warehouseId } = await setup();
    const invoice = await post('/purchasing/invoices', {
      supplierId,
      warehouseId,
      invoiceDate: TODAY,
      lines: [{ productId, quantity: 1, unitPrice: 1 }],
    });
    const invoiceId = data<{ id: string }>(invoice).id;

    const list = await get('/purchasing/suppliers', other.adminToken);
    const read = await get(
      `/purchasing/invoices/${invoiceId}`,
      other.adminToken,
    );
    const steal = await post(
      `/purchasing/invoices/${invoiceId}/post`,
      {},
      other.adminToken,
    );

    expect(data<{ total: number }>(list).total).toBe(0);
    expect(read.status).toBe(404);
    expect(steal.status).toBe(404);
  });
});
