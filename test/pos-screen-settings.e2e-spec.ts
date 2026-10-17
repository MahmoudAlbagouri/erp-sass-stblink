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
 * مميزات شاشة الكاشير لكل شركة: القوالب، التشغيل والإقفال، ما تسمح به الباقة،
 * ووصولها للجهاز — والبيع الآجل المقفل يرفضه السيرفر إلا ما بيع قبل إقفاله.
 */
describe('POS screen settings (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;
  let productId: string;
  let customerId: string;
  let deviceId: string;
  let installationId: string;
  let deviceKey: string;
  let counter = 0;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
  const get = (path: string, token = tenant.adminToken) =>
    api().get(path).set(auth(token));
  const post = (path: string, body: object = {}, token = tenant.adminToken) =>
    api().post(path).set(auth(token)).send(body);
  const patch = (path: string, body: object, token = tenant.adminToken) =>
    api().patch(path).set(auth(token)).send(body);
  const asDevice = () => ({
    'x-pos-device': deviceId,
    'x-pos-key': deviceKey,
    'x-pos-installation': installationId,
  });
  const deviceSync = (operations: object[]) =>
    api().post('/pos/device/sync').set(asDevice()).send({ operations });
  const results = (res: request.Response) =>
    data<{ results: { status: string; message?: string }[] }>(res).results;

  type Features = Record<string, boolean>;
  interface ScreenSettings {
    template: string;
    features: Features;
    available: Record<string, boolean>;
    templates: { key: string; features: Features }[];
    groups: { title: string; features: { key: string }[] }[];
  }

  /** فاتورة بـ 4.6: مدفوع `paid` والباقي على حساب العميل */
  const sale = (shiftId: string, paid: number, issuedAt: string) => {
    counter += 1;
    return {
      id: `sale-${counter}`,
      type: 'sale',
      payload: {
        uuid: randomUUID(),
        number: `SC-${String(counter).padStart(6, '0')}`,
        issuedAt,
        shiftId,
        customerId,
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
        payments: paid ? [{ method: 'cash', amount: paid }] : [],
      },
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
    counter = 0;
    tenant = await createTenantFixture(dataSource, {
      features: [
        'products_module',
        'inventory_module',
        'sales_module',
        'pos_module',
      ],
    });
    const units = data<{ id: string }[]>(await get('/catalog/units'));
    productId = data<{ id: string }>(
      await post('/catalog/products', {
        name: 'مياه 330 مل',
        baseUnitId: units[0].id,
        salePrice: 2.3,
      }),
    ).id;
    customerId = data<{ id: string }>(
      await post('/sales/customers', { name: 'مطعم الريف' }),
    ).id;
    const warehouseId = data<{ id: string; type: string }[]>(
      await get('/inventory/warehouses'),
    ).find((w) => w.type === 'main')!.id;
    deviceId = data<{ id: string }>(
      await post('/pos/devices', { name: 'كاشير 1', code: 'SC', warehouseId }),
    ).id;
    installationId = randomUUID();
    deviceKey = data<{ deviceKey: string }>(
      await post(`/pos/devices/${deviceId}/bind`, { installationId }),
    ).deviceKey;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('starts with every feature on, applies templates, and sends them to the device', async () => {
    const initial = data<ScreenSettings>(await get('/pos/screen-settings'));
    expect(initial.template).toBe('all');
    expect(initial.features).toMatchObject({
      customers: true,
      creditSales: true,
      priceChange: true,
      delivery: true,
      quickPay: false,
      // الميزان مقفل في إعدادات الفوترة افتراضياً
      scaleBarcode: false,
    });
    // الباقة بلا توصيل ولا مطاعم
    expect(initial.available).toEqual({
      delivery: false,
      tables: false,
      kitchen: false,
    });
    expect(initial.templates.map((t) => t.key)).toEqual([
      'all',
      'supermarket',
      'restaurant',
      'retail',
      'pharmacy',
    ]);
    expect(
      initial.groups.flatMap((g) => g.features.map((f) => f.key)),
    ).toHaveLength(21);

    const market = data<ScreenSettings>(
      await patch('/pos/screen-settings', { template: 'supermarket' }),
    );
    expect(market.template).toBe('supermarket');
    expect(market.features).toMatchObject({
      quickPay: true,
      scaleBarcode: true,
      priceChange: false,
      tables: false,
    });

    // تعديل ميزة بعد القالب: "مخصص"، وإقفال اختيار العميل يقفل ما يحتاجه
    const custom = data<ScreenSettings>(
      await patch('/pos/screen-settings', { features: { customers: false } }),
    );
    expect(custom.template).toBe('custom');
    expect(custom.features).toMatchObject({
      customers: false,
      addCustomer: false,
      creditSales: false,
    });

    // الجهاز يستلمها مع بياناته، والميزان من مصدره الوحيد
    const boot = data<{
      posOptions: {
        features: Features;
        template: string;
        scale: { enabled: boolean };
      };
    }>(await api().get('/pos/device/bootstrap').set(asDevice()));
    expect(boot.posOptions.template).toBe('custom');
    expect(boot.posOptions.features).toMatchObject({
      customers: false,
      quickPay: true,
    });
    expect(boot.posOptions.scale.enabled).toBe(true);

    // صفحة الفوترة تحفظ الميزان والموافقات فقط: لا تمسح مميزات الشاشة
    const scale = {
      enabled: false,
      prefixes: ['21'],
      itemDigits: 5,
      valueType: 'weight',
      valueDecimals: 3,
    };
    expect(
      (
        await patch('/sales/settings', {
          posOptions: {
            scale,
            approvals: { void: true, cashOut: false, manualDrawer: false },
          },
        })
      ).status,
    ).toBe(200);
    const after = data<ScreenSettings>(await get('/pos/screen-settings'));
    expect(after.features).toMatchObject({
      customers: false,
      quickPay: true,
      // الميزان أُقفل من صفحة الفوترة: يظهر مقفلاً هنا أيضاً
      scaleBarcode: false,
    });
  });

  it('rejects credit sales once disabled — except those made before', async () => {
    const shiftId = randomUUID();
    expect(
      results(
        await deviceSync([
          {
            id: `open-${shiftId}`,
            type: 'shift.open',
            payload: {
              id: shiftId,
              openedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
              openingCash: 0,
            },
          },
        ]),
      )[0].status,
    ).toBe('ok');

    await patch('/pos/screen-settings', { features: { creditSales: false } });

    const before = new Date(Date.now() - 3_600_000).toISOString();
    const now = new Date().toISOString();
    const synced = results(
      await deviceSync([
        // بيع بلا إنترنت قبل الإقفال: حصل فعلاً
        sale(shiftId, 1, before),
        // بعد الإقفال: يُرفض
        sale(shiftId, 1, now),
        // مدفوع بالكامل: ليس آجلاً
        sale(shiftId, 4.6, now),
      ]),
    );
    expect(synced.map((r) => r.status)).toEqual(['ok', 'error', 'ok']);
    expect(synced[1].message).toContain('البيع الآجل غير مفعّل');

    await patch('/pos/screen-settings', { features: { creditSales: true } });
    expect(results(await deviceSync([sale(shiftId, 0, now)]))[0].status).toBe(
      'ok',
    );
  });

  it('is managed by its own permission and reflects the plan', async () => {
    const viewer = tenant.tokenWith(['view_pos']);
    expect((await get('/pos/screen-settings', viewer)).status).toBe(200);
    expect(
      (await patch('/pos/screen-settings', { template: 'restaurant' }, viewer))
        .status,
    ).toBe(403);
    expect(
      (await patch('/pos/screen-settings', { template: 'bakery' })).status,
    ).toBe(400);

    const full = await createTenantFixture(dataSource, {
      features: ['pos_module', 'delivery_module', 'restaurant_module'],
    });
    expect(
      data<ScreenSettings>(await get('/pos/screen-settings', full.adminToken))
        .available,
    ).toEqual({ delivery: true, tables: true, kitchen: true });
  });
});
