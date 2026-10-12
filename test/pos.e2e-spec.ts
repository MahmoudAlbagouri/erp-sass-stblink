import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * نقاط البيع عبر الـ HTTP كما يستخدمها جهاز الكاشير: تسجيل الجهاز، تنزيل
 * بيانات البيع، ثم رفع وردية كاملة بيعت محلياً.
 */
describe('POS API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  const FEATURES = [
    'products_module',
    'inventory_module',
    'sales_module',
    'pos_module',
  ];

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  // كل الردود تُغلَّف بـ TransformInterceptor: { success, data, ... }
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

  const get = (path: string, token = tenant.adminToken) =>
    api().get(path).set(auth(token));
  const post = (path: string, body: object = {}, token = tenant.adminToken) =>
    api().post(path).set(auth(token)).send(body);

  /** صنف + جهاز كاشير على المخزن الرئيسي */
  const setup = async () => {
    const units = data<{ id: string }[]>(await get('/catalog/units'));
    const product = await post('/catalog/products', {
      name: 'مياه 330 مل',
      baseUnitId: units[0].id,
      salePrice: 2.3,
      barcodes: [{ barcode: '6281000000017' }],
    });
    const warehouses = data<{ id: string; type: string }[]>(
      await get('/inventory/warehouses'),
    );
    const warehouseId = warehouses.find((w) => w.type === 'main')!.id;
    const productId = data<{ id: string }>(product).id;
    await post('/inventory/adjustments', {
      warehouseId,
      type: 'opening',
      lines: [{ productId, quantity: 50, unitCost: 1 }],
    });
    const device = await post('/pos/devices', {
      name: 'كاشير 1',
      code: 'POS1',
      warehouseId,
    });

    const deviceId = data<{ id: string }>(device).id;
    const installationId = randomUUID();
    await post(`/pos/devices/${deviceId}/bind`, { installationId });

    return { productId, warehouseId, deviceId, installationId };
  };

  const sale = (shiftId: string, productId: string, counter: number) => ({
    id: `sale-${counter}`,
    type: 'sale',
    payload: {
      uuid: randomUUID(),
      number: `POS1-00000${counter}`,
      issuedAt: '2026-10-12T06:30:00.000Z',
      shiftId,
      pricesIncludeTax: true,
      lines: [
        {
          productId,
          quantity: 2,
          unitPrice: 2.3,
          discount: 0,
          taxRate: 15,
          subtotal: 4,
          taxAmount: 0.6,
          total: 4.6,
        },
      ],
      payments: [{ method: 'cash', amount: 4.6 }],
    },
  });

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

  it('bootstraps a device then syncs a shift sold offline', async () => {
    const { productId, deviceId, installationId } = await setup();
    const shiftId = randomUUID();

    const bootstrap = await get(
      `/pos/bootstrap?deviceId=${deviceId}&installationId=${installationId}`,
    );
    expect(bootstrap.status).toBe(200);
    expect(
      data<{ products: { id: string; barcodes: unknown[] }[] }>(bootstrap)
        .products,
    ).toMatchObject([
      { id: productId, barcodes: [{ barcode: '6281000000017' }] },
    ]);

    const synced = await post('/pos/sync', {
      deviceId,
      installationId,
      operations: [
        {
          id: 'open',
          type: 'shift.open',
          payload: {
            id: shiftId,
            openedAt: '2026-10-12T05:00:00.000Z',
            openingCash: 50,
          },
        },
        sale(shiftId, productId, 1),
        sale(shiftId, productId, 2),
        {
          id: 'close',
          type: 'shift.close',
          payload: {
            id: shiftId,
            closedAt: '2026-10-12T14:00:00.000Z',
            closingCash: 59.2,
          },
        },
      ],
    });

    expect(synced.status).toBe(200);
    expect(
      data<{ results: { status: string }[]; lastCounter: number }>(synced),
    ).toMatchObject({
      results: [
        { status: 'ok' },
        { status: 'ok' },
        { status: 'ok' },
        { status: 'ok' },
      ],
      lastCounter: 2,
    });

    // المبيعات ظهرت في لوحة التحكم كأي فاتورة بيع، والمخزون نقص
    const invoices = data<{ total: number; data: { number: string }[] }>(
      await get('/sales/invoices'),
    );
    expect(invoices.total).toBe(2);
    const stockLevels = data<{ data: { quantity: number }[] }>(
      await get('/inventory/stock'),
    );
    expect(stockLevels.data).toMatchObject([{ quantity: 46 }]);

    const shifts = data<{ data: object[] }>(await get('/pos/shifts'));
    expect(shifts.data).toMatchObject([
      {
        status: 'closed',
        salesTotal: 9.2,
        expectedCash: 59.2,
        cashDifference: 0,
      },
    ]);
  });

  it('rejects a malformed sync request with 400', async () => {
    const { deviceId, installationId } = await setup();

    expect(
      (await post('/pos/sync', { deviceId: 'x', operations: [] })).status,
    ).toBe(400);
    // بدون معرّف الشاشة لا مزامنة
    expect((await post('/pos/sync', { deviceId, operations: [] })).status).toBe(
      400,
    );
    expect(
      (
        await post('/pos/sync', {
          deviceId,
          installationId,
          operations: [{ id: '1', type: 'refund', payload: {} }],
        })
      ).status,
    ).toBe(400);
    expect((await get('/pos/bootstrap')).status).toBe(400);
    expect(
      (
        await post('/pos/devices', {
          name: 'x',
          code: 'bad code',
          warehouseId: deviceId,
        })
      ).status,
    ).toBe(400);
  });

  it('enforces the device quota and the plan feature', async () => {
    tenant = await createTenantFixture(dataSource, {
      features: FEATURES,
      quotas: { max_pos_devices: 1 },
    });
    const { warehouseId } = await setup(); // الجهاز الأول

    expect(
      (await post('/pos/devices', { name: 'ثانٍ', code: 'POS2', warehouseId }))
        .status,
    ).toBe(403);

    const noFeature = await createTenantFixture(dataSource, {
      features: FEATURES.filter((f) => f !== 'pos_module'),
    });
    expect((await get('/pos/devices', noFeature.adminToken)).status).toBe(403);
    expect((await get('/pos/ping', noFeature.adminToken)).status).toBe(403);
  });

  it('checks permissions and keeps tenants isolated', async () => {
    const { deviceId, warehouseId, installationId } = await setup();
    const cashier = tenant.tokenWith(['view_pos', 'use_pos']);
    const other = await createTenantFixture(dataSource, { features: FEATURES });

    // الكاشير يبيع ويرى الأجهزة، لكنه لا يضيف جهازاً
    expect((await get('/pos/ping', cashier)).status).toBe(200);
    expect((await get('/pos/devices', cashier)).status).toBe(200);
    expect(
      (
        await post(
          '/pos/devices',
          { name: 'x', code: 'POS3', warehouseId },
          cashier,
        )
      ).status,
    ).toBe(403);

    // شركة أخرى لا ترى الجهاز ولا تنزّل بياناته ولا ترفع عليه
    expect(
      data<unknown[]>(await get('/pos/devices', other.adminToken)),
    ).toEqual([]);
    expect(
      (
        await get(
          `/pos/bootstrap?deviceId=${deviceId}&installationId=${installationId}`,
          other.adminToken,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await post(
          '/pos/sync',
          { deviceId, installationId, operations: [] },
          other.adminToken,
        )
      ).status,
    ).toBe(404);
  });

  it('returns from the cashier screen only with the returns permission', async () => {
    const { productId, deviceId, installationId } = await setup();
    const shiftId = randomUUID();
    const cashier = tenant.tokenWith(['view_pos', 'use_pos']);
    const senior = tenant.tokenWith([
      'view_pos',
      'use_pos',
      'process_pos_returns',
    ]);
    const push = (operations: unknown[], token: string) =>
      post('/pos/sync', { deviceId, installationId, operations }, token);
    const back = () => ({
      id: 'return-1',
      type: 'return',
      payload: {
        uuid: randomUUID(),
        invoiceNumber: 'POS1-000001',
        issuedAt: '2026-10-12T09:00:00.000Z',
        shiftId,
        lines: [{ lineIndex: 0, quantity: 1 }],
        refundMethod: 'cash',
        refundAmount: 2.3,
      },
    });

    await push(
      [
        {
          id: 'open',
          type: 'shift.open',
          payload: {
            id: shiftId,
            openedAt: '2026-10-12T06:00:00.000Z',
            openingCash: 100,
          },
        },
        sale(shiftId, productId, 1),
      ],
      cashier,
    );

    // كاشير بلا صلاحية المرتجع: لا يبحث عن الفاتورة ولا يُقبل مرتجعه
    expect((await get('/pos/invoices/POS1-000001', cashier)).status).toBe(403);
    const refused = await push([back()], cashier);
    expect(
      data<{ results: { status: string }[] }>(refused).results[0].status,
    ).toBe('error');

    const found = await get('/pos/invoices/POS1-000001', senior);
    expect(found.status).toBe(200);
    expect(
      data<{ lines: { lineIndex: number; quantity: number }[] }>(found).lines,
    ).toMatchObject([{ lineIndex: 0, quantity: 2 }]);
    expect((await get('/pos/invoices/NOPE-1', senior)).status).toBe(404);

    const accepted = await push([back()], senior);
    expect(
      data<{ results: { status: string }[] }>(accepted).results[0].status,
    ).toBe('ok');
    // عملية بصيغة خاطئة تُرفض وحدها برسالة
    const malformed = await push(
      [{ ...back(), payload: { ...back().payload, refundMethod: 'gold' } }],
      senior,
    );
    expect(
      data<{ results: { status: string }[] }>(malformed).results[0].status,
    ).toBe('error');

    const shifts = data<{
      data: { cashRefunds: number; expectedCash: number }[];
    }>(await get('/pos/shifts'));
    expect(shifts.data[0]).toMatchObject({
      cashRefunds: 2.3,
      expectedCash: 102.3,
    });
  });

  it('binds a device to one screen and lets only a manager free it', async () => {
    const { deviceId, installationId } = await setup();
    const cashier = tenant.tokenWith(['view_pos', 'use_pos']);
    const phone = randomUUID();
    const bind = (id: string, token?: string) =>
      post(`/pos/devices/${deviceId}/bind`, { installationId: id }, token);

    // شاشة ثانية على نفس الجهاز: مرفوضة في الربط والتنزيل والرفع
    expect((await bind(phone, cashier)).status).toBe(409);
    expect(
      (
        await get(
          `/pos/bootstrap?deviceId=${deviceId}&installationId=${phone}`,
          cashier,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await post(
          '/pos/sync',
          { deviceId, installationId: phone, operations: [] },
          cashier,
        )
      ).status,
    ).toBe(409);
    // الشاشة الأصلية تعيد الربط بلا مشكلة
    expect((await bind(installationId, cashier)).status).toBe(200);
    expect((await bind('not-a-uuid')).status).toBe(400);

    // فك الربط قرار المدير، وبعده تُربط الشاشة الجديدة
    expect(
      (await post(`/pos/devices/${deviceId}/unbind`, {}, cashier)).status,
    ).toBe(403);
    expect((await post(`/pos/devices/${deviceId}/unbind`, {})).status).toBe(
      200,
    );
    expect((await bind(phone, cashier)).status).toBe(200);
    expect(
      (
        await post('/pos/sync', {
          deviceId,
          installationId,
          operations: [],
        })
      ).status,
    ).toBe(409);
  });
});
