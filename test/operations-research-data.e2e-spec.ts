import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

interface Named {
  id: string;
  name: string;
}

/**
 * بيانات بحوث العمليات (docs/operations-research.md): ما يُسجَّل اليوم ليُحلَّل
 * لاحقاً — سبب التسوية، مدة توريد المورد وتاريخ الطلب، موقع مستلم التوصيل،
 * والعرض المطبَّق على سطر بيع الكاشير. كلها اختيارية، ولا يُرفض بها بيع كاشير.
 */
describe('Operations research data capture (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;
  let productId: string;
  let warehouseId: string;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
  const get = (path: string) => api().get(path).set(auth(tenant.adminToken));
  const post = (path: string, body: object = {}) =>
    api().post(path).set(auth(tenant.adminToken)).send(body);
  const patch = (path: string, body: object) =>
    api().patch(path).set(auth(tenant.adminToken)).send(body);

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
      features: [
        'products_module',
        'inventory_module',
        'purchasing_module',
        'sales_module',
        'pos_module',
        'delivery_module',
      ],
    });
    const units = data<Named[]>(await get('/catalog/units'));
    productId = data<Named>(
      await post('/catalog/products', {
        name: 'حليب 1 لتر',
        baseUnitId: units[0].id,
        salePrice: 11.5,
      }),
    ).id;
    warehouseId = data<(Named & { type: string })[]>(
      await get('/inventory/warehouses'),
    ).find((w) => w.type === 'main')!.id;
    await post('/inventory/adjustments', {
      warehouseId,
      type: 'opening',
      lines: [{ productId, quantity: 100, unitCost: 6 }],
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('records why stock was adjusted and filters movements by it', async () => {
    const expired = await post('/inventory/adjustments', {
      warehouseId,
      type: 'adjustment',
      reason: 'expiry',
      lines: [{ productId, quantity: -3 }],
    });
    expect(expired.status).toBe(201);
    expect(data<{ reason: string }[]>(expired)[0].reason).toBe('expiry');

    // جهاز قديم بلا سبب: يُقبل والسبب فارغ
    await post('/inventory/adjustments', {
      warehouseId,
      type: 'adjustment',
      lines: [{ productId, quantity: -1 }],
    }).expect(201);

    const byReason = data<{ data: { quantity: number; reason: string }[] }>(
      await get('/inventory/movements?reason=expiry'),
    ).data;
    expect(byReason).toHaveLength(1);
    expect(byReason[0]).toMatchObject({ quantity: -3, reason: 'expiry' });

    await post('/inventory/adjustments', {
      warehouseId,
      type: 'adjustment',
      reason: 'lost_in_space',
      lines: [{ productId, quantity: -1 }],
    }).expect(400);
    // الرصيد الافتتاحي ليس تسوية: لا سبب له
    await post('/inventory/adjustments', {
      warehouseId,
      type: 'opening',
      reason: 'found',
      lines: [{ productId, quantity: 1, unitCost: 6 }],
    }).expect(400);
  });

  it("keeps a supplier's lead time and each order's date", async () => {
    const created = await post('/purchasing/suppliers', {
      name: 'مصنع الألبان',
      leadTimeDays: 3,
    });
    expect(created.status).toBe(201);
    const supplier = data<{ id: string; leadTimeDays: number | null }>(created);
    expect(supplier.leadTimeDays).toBe(3);

    const cleared = await patch(`/purchasing/suppliers/${supplier.id}`, {
      leadTimeDays: null,
    });
    expect(data<{ leadTimeDays: null }>(cleared).leadTimeDays).toBeNull();

    const body = {
      supplierId: supplier.id,
      warehouseId,
      invoiceDate: '2026-11-10',
      orderDate: '2026-11-06',
      lines: [{ productId, quantity: 10, unitPrice: 6 }],
    };
    const invoice = await post('/purchasing/invoices', body);
    expect(invoice.status).toBe(201);
    const { id, orderDate } = data<{ id: string; orderDate: string }>(invoice);
    expect(orderDate).toBe('2026-11-06');

    // البضاعة لا تصل قبل طلبها
    await post('/purchasing/invoices', {
      ...body,
      orderDate: '2026-11-11',
    }).expect(400);
    await patch(`/purchasing/invoices/${id}`, {
      invoiceDate: '2026-11-05',
    }).expect(400);

    const updated = await patch(`/purchasing/invoices/${id}`, {
      orderDate: null,
    });
    expect(updated.status).toBe(200);
    expect(data<{ orderDate: null }>(updated).orderDate).toBeNull();
  });

  it('stores the delivery location from the dashboard, both coordinates or none', async () => {
    const order = {
      warehouseId,
      recipientName: 'أحمد علي',
      phone: '0500000001',
      address: 'حي النرجس، شارع 12',
      paymentMode: 'cod',
      lines: [{ productId, quantity: 1, unitPrice: 11.5 }],
    };
    const created = await post('/delivery/orders', {
      ...order,
      latitude: 24.8123456789,
      longitude: 46.6312345,
    });
    expect(created.status).toBe(201);
    expect(
      data<{ latitude: number; longitude: number }>(created),
    ).toMatchObject({ latitude: 24.812346, longitude: 46.631235 });

    await post('/delivery/orders', { ...order, latitude: 24.8 }).expect(400);
    await post('/delivery/orders', {
      ...order,
      latitude: 124.8,
      longitude: 46.6,
    }).expect(400);
  });

  describe('POS sales', () => {
    let deviceId: string;
    let installationId: string;
    let deviceKey: string;
    let shiftId: string;
    let counter = 0;

    const asDevice = () => ({
      'x-pos-device': deviceId,
      'x-pos-key': deviceKey,
      'x-pos-installation': installationId,
    });
    const sync = async (...operations: object[]) =>
      data<{ results: { id: string; status: string; message?: string }[] }>(
        await api()
          .post('/pos/device/sync')
          .set(asDevice())
          .send({ operations }),
      ).results;
    const sale = (line: object = {}, extra: object = {}) => {
      counter += 1;
      const uuid = randomUUID();
      return {
        uuid,
        op: {
          id: `sale-${counter}`,
          type: 'sale',
          payload: {
            uuid,
            number: `POS1-${String(counter).padStart(6, '0')}`,
            issuedAt: new Date().toISOString(),
            shiftId,
            pricesIncludeTax: true,
            lines: [
              {
                productId,
                quantity: 2,
                unitPrice: 11.5,
                discount: 2.3,
                taxRate: 15,
                subtotal: 18,
                taxAmount: 2.7,
                total: 20.7,
                ...line,
              },
            ],
            payments: [{ method: 'cash', amount: 20.7 }],
            ...extra,
          },
        },
      };
    };
    const lineOf = async (uuid: string) => {
      const [row] = await dataSource.query<
        { promotionId: string | null; promotionSaving: string | null }[]
      >(
        `SELECT l."promotionId", l."promotionSaving"
           FROM sales_invoice_lines l
           JOIN sales_invoices i ON i.id = l."invoiceId"
          WHERE i.uuid = $1`,
        [uuid],
      );
      return row;
    };

    beforeEach(async () => {
      counter = 0;
      deviceId = data<Named>(
        await post('/pos/devices', {
          name: 'كاشير 1',
          code: 'POS1',
          warehouseId,
        }),
      ).id;
      installationId = randomUUID();
      deviceKey = data<{ deviceKey: string }>(
        await post(`/pos/devices/${deviceId}/bind`, { installationId }),
      ).deviceKey;
      shiftId = randomUUID();
      expect(
        await sync({
          id: 'open',
          type: 'shift.open',
          payload: {
            id: shiftId,
            openedAt: new Date().toISOString(),
            openingCash: 0,
            cashierName: 'سالم',
          },
        }),
      ).toMatchObject([{ status: 'ok' }]);
    });

    it('keeps the promotion applied to each line and what it saved', async () => {
      const promotionId = data<Named>(
        await post('/pos/promotions', {
          name: 'خصم الحليب 10%',
          type: 'percent_off',
          productId,
          percent: 10,
        }),
      ).id;

      // توفير بضجيج فاصلة عائمة من الجهاز: يُقرَّب ولا يُرفض به البيع
      const promoted = sale({
        promotionId,
        promotionSaving: 2.3000000000000003,
      });
      const plain = sale(
        { discount: 0, subtotal: 20, taxAmount: 3, total: 23 },
        {
          payments: [{ method: 'cash', amount: 23 }],
        },
      );
      expect(await sync(promoted.op, plain.op)).toMatchObject([
        { status: 'ok' },
        { status: 'ok' },
      ]);

      expect(await lineOf(promoted.uuid)).toEqual({
        promotionId,
        promotionSaving: '2.300',
      });
      expect(await lineOf(plain.uuid)).toEqual({
        promotionId: null,
        promotionSaving: null,
      });
    });

    it('accepts a cashier delivery sale even when its location is broken', async () => {
      const located = sale(
        {},
        {
          delivery: {
            recipientName: 'منى',
            phone: '0500000002',
            address: 'حي الياسمين',
            latitude: 24.7,
            longitude: 46.7,
          },
        },
      );
      const broken = sale(
        {},
        {
          delivery: {
            recipientName: 'منى',
            phone: '0500000002',
            address: 'حي الياسمين',
            latitude: 24.7,
          },
        },
      );
      expect(await sync(located.op, broken.op)).toMatchObject([
        { status: 'ok' },
        { status: 'ok' },
      ]);

      const rows = await dataSource.query<
        { uuid: string; latitude: string | null; longitude: string | null }[]
      >(
        `SELECT i.uuid, o.latitude, o.longitude
           FROM delivery_orders o JOIN sales_invoices i ON i.id = o."invoiceId"`,
      );
      const of = (uuid: string) => rows.find((r) => r.uuid === uuid);
      expect(of(located.uuid)).toMatchObject({
        latitude: '24.700000',
        longitude: '46.700000',
      });
      expect(of(broken.uuid)).toMatchObject({
        latitude: null,
        longitude: null,
      });
    });
  });
});
