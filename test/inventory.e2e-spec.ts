import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import {
  createTenantFixture,
  systemOwnerToken,
  TenantFixture,
} from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * موديول المخزون عبر الـ HTTP: الخطة، الصلاحيات، حد المخازن، ودورة كاملة
 * (رصيد افتتاحي ← تحويل ← استلام ← جرد) كما ينفّذها الفرونت.
 */
describe('Inventory API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  const FEATURES = ['products_module', 'inventory_module'];

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  // كل الردود تُغلَّف بـ TransformInterceptor: { success, data, ... }
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

  const get = (path: string, token = tenant.adminToken) =>
    api().get(path).set(auth(token));
  const post = (path: string, body: object = {}, token = tenant.adminToken) =>
    api().post(path).set(auth(token)).send(body);

  const createProduct = async (name: string): Promise<string> => {
    const units = data<{ id: string }[]>(await get('/catalog/units'));
    const created = await post('/catalog/products', {
      name,
      baseUnitId: units[0].id,
      salePrice: 2,
    });
    return data<{ id: string }>(created).id;
  };

  const mainWarehouseId = async (): Promise<string> =>
    data<{ id: string; type: string }[]>(
      await get('/inventory/warehouses'),
    ).find((w) => w.type === 'main')!.id;

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
      features: FEATURES,
      quotas: { max_warehouses: 2 },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('runs a full cycle: opening, transfer, receive, stocktake', async () => {
    const productId = await createProduct('مياه 330 مل');
    const mainId = await mainWarehouseId();
    const branch = await post('/inventory/warehouses', { name: 'فرع جدة' });
    const branchId = data<{ id: string }>(branch).id;
    expect(branch.status).toBe(201);

    const opening = await post('/inventory/adjustments', {
      warehouseId: mainId,
      type: 'opening',
      lines: [{ productId, quantity: 100, unitCost: 1.5 }],
    });
    expect(opening.status).toBe(201);

    const transfer = await post('/inventory/transfers', {
      fromWarehouseId: mainId,
      toWarehouseId: branchId,
      lines: [{ productId, quantity: 40 }],
    });
    const transferId = data<{ id: string }>(transfer).id;
    expect(data(transfer)).toMatchObject({
      number: 'TR-000001',
      status: 'draft',
    });

    expect((await post(`/inventory/transfers/${transferId}/send`)).status).toBe(
      200,
    );
    const received = await post(`/inventory/transfers/${transferId}/receive`, {
      lines: [{ productId, receivedQuantity: 38 }],
    });
    expect(data(received)).toMatchObject({ status: 'received' });

    const stocktake = await post('/inventory/stocktakes', {
      warehouseId: branchId,
      lines: [{ productId, countedQuantity: 35 }],
    });
    const stocktakeId = data<{ id: string }>(stocktake).id;
    expect(
      (await post(`/inventory/stocktakes/${stocktakeId}/post`)).status,
    ).toBe(200);

    const levels = data<{
      data: { warehouseId: string; quantity: number; value: number }[];
    }>(await get('/inventory/stock'));
    const byWarehouse = new Map(levels.data.map((l) => [l.warehouseId, l]));
    expect(byWarehouse.get(mainId)).toMatchObject({ quantity: 60, value: 90 });
    expect(byWarehouse.get(branchId)).toMatchObject({
      quantity: 35,
      value: 52.5,
    });

    const movements = data<{ total: number }>(
      await get(`/inventory/movements?productId=${productId}`),
    );
    expect(movements.total).toBe(4); // افتتاحي، خروج تحويل، دخول تحويل، جرد

    const summary = data<{ value: number }>(
      await get('/inventory/stock/summary'),
    );
    expect(summary.value).toBe(142.5);
  });

  it('counts a stocktake from several devices, offline-safe', async () => {
    const units = data<{ id: string }[]>(await get('/catalog/units'));
    const water = data<{ id: string }>(
      await post('/catalog/products', {
        name: 'مياه',
        baseUnitId: units[0].id,
        salePrice: 2,
        barcodes: [{ barcode: '6281000000017' }],
      }),
    ).id;
    const rice = await createProduct('أرز');
    const service = data<{ id: string }>(
      await post('/catalog/products', {
        name: 'تغليف',
        type: 'service',
        baseUnitId: units[0].id,
        salePrice: 5,
      }),
    ).id;
    const warehouseId = await mainWarehouseId();
    await post('/inventory/adjustments', {
      warehouseId,
      type: 'opening',
      lines: [
        { productId: water, quantity: 10, unitCost: 1 },
        { productId: rice, quantity: 4, unitCost: 3 },
      ],
    });

    // يبدأ فارغاً ويُعدّ من شاشة العدّ — ولا يُعتمد فارغاً
    const created = await post('/inventory/stocktakes', {
      warehouseId,
      lines: [],
    });
    expect(created.status).toBe(201);
    const id = data<{ id: string }>(created).id;
    const openedAt = data<{ updatedAt: string }>(created).updatedAt;
    expect((await post(`/inventory/stocktakes/${id}/post`)).status).toBe(400);

    // نسخة البحث على الجهاز: المخزني وباركوداته، بلا الخدمات
    const catalog = data<{
      products: { id: string; barcodes: { code: string; factor: number }[] }[];
    }>(await get(`/inventory/stocktakes/${id}/catalog`));
    expect(catalog.products.map((p) => p.id).sort()).toEqual(
      [water, rice].sort(),
    );
    expect(catalog.products.find((p) => p.id === water)!.barcodes).toEqual([
      { code: '6281000000017', factor: 1 },
    ]);

    const minutesAgo = (minutes: number) =>
      new Date(Date.now() - minutes * 60_000).toISOString();
    const t10 = minutesAgo(10);
    const count = (counts: object[]) =>
      post(`/inventory/stocktakes/${id}/counts`, { counts });
    type Counted = {
      results: { status: string }[];
      stocktake: { lines: { productId: string; countedQuantity: number }[] };
    };

    // الجهاز (أ) عدّ قبل 10 دقائق ووصل أولاً
    const a = data<Counted>(
      await count([
        { productId: water, countedQuantity: 8, countedAt: t10 },
        { productId: rice, countedQuantity: 3, countedAt: t10 },
      ]),
    );
    expect(a.results.map((r) => r.status)).toEqual(['ok', 'ok']);

    // الجهاز (ب) كان بلا إنترنت: عدّه الأقدم للمياه لا يغلب الأحدث، وصنف
    // الخدمة يُرفض وحده، وإزالة الأرز (بعد عدّه) تُنفَّذ
    const b = data<Counted>(
      await count([
        { productId: water, countedQuantity: 5, countedAt: minutesAgo(30) },
        { productId: service, countedQuantity: 1, countedAt: minutesAgo(30) },
        { productId: rice, countedQuantity: null, countedAt: minutesAgo(5) },
      ]),
    );
    expect(b.results.map((r) => r.status)).toEqual(['stale', 'error', 'ok']);
    expect(b.stocktake.lines).toEqual([
      expect.objectContaining({ productId: water, countedQuantity: 8 }),
    ]);

    // إعادة رفع نفس العدّ (انقطع الاتصال قبل الرد) تضع الكمية ولا تضيفها
    const replay = data<Counted>(
      await count([{ productId: water, countedQuantity: 8, countedAt: t10 }]),
    );
    expect(replay.stocktake.lines).toEqual([
      expect.objectContaining({ productId: water, countedQuantity: 8 }),
    ]);

    // لوحة تحكم فتحت الجرد قبل العدّ: حفظها يُرفض بدل أن يمسح ما عُدّ
    const patch = (body: object) =>
      api()
        .patch(`/inventory/stocktakes/${id}`)
        .set(auth(tenant.adminToken))
        .send(body);
    expect(
      (await patch({ lines: [], expectedUpdatedAt: openedAt })).status,
    ).toBe(409);
    const current = data<{ updatedAt: string }>(
      await get(`/inventory/stocktakes/${id}`),
    );
    expect(
      (
        await patch({
          lines: [{ productId: water, countedQuantity: 8 }],
          expectedUpdatedAt: current.updatedAt,
        })
      ).status,
    ).toBe(200);

    // الحفظ أبقى وقت عدّ المياه (لم تتغير): عدّ أقدم يصل الآن لا يغلبه
    const late = data<Counted>(
      await count([
        { productId: water, countedQuantity: 1, countedAt: minutesAgo(20) },
      ]),
    );
    expect(late.results.map((r) => r.status)).toEqual(['stale']);

    expect((await post(`/inventory/stocktakes/${id}/post`)).status).toBe(200);
    const levels = data<{ data: { productId: string; quantity: number }[] }>(
      await get(`/inventory/stock?warehouseId=${warehouseId}`),
    ).data;
    expect(levels.find((l) => l.productId === water)?.quantity).toBe(8);
    // الأرز أُزيل من الجرد: رصيده كما هو
    expect(levels.find((l) => l.productId === rice)?.quantity).toBe(4);

    // بعد الاعتماد لا عدّ
    expect(
      (
        await count([
          { productId: water, countedQuantity: 2, countedAt: minutesAgo(1) },
        ])
      ).status,
    ).toBe(400);
  });

  it('imports a price list with opening stock in one request', async () => {
    const list = {
      defaultUnit: 'كيلوجرام',
      quantity: 200,
      costRatio: 0.8,
      items: [
        { name: 'فلفل أبيض', category: 'التوابل', salePrice: 560 },
        {
          name: 'كمون بلدي',
          category: 'التوابل',
          salePrice: 250,
          quantity: 50,
        },
        { name: 'ملح ليمون', salePrice: 69, unitCost: 40 },
      ],
    };

    const res = await post('/inventory/stock/import-products', list);

    expect(res.status).toBe(200);
    expect(data(res)).toMatchObject({
      stocked: 3,
      warehouse: { name: 'المخزن الرئيسي' },
      failed: [],
    });

    const levels = data<{
      data: { productName: string; quantity: number; avgCost: number }[];
    }>(await get('/inventory/stock'));
    const byName = new Map(levels.data.map((l) => [l.productName, l]));
    expect(byName.get('فلفل أبيض')).toMatchObject({
      quantity: 200,
      avgCost: 448,
    });
    expect(byName.get('كمون بلدي')).toMatchObject({
      quantity: 50,
      avgCost: 200,
    });
    expect(byName.get('ملح ليمون')).toMatchObject({
      quantity: 200,
      avgCost: 40,
    });

    // إعادة إرسال القائمة لا تضاعف الرصيد
    const again = await post('/inventory/stock/import-products', list);
    expect(data(again)).toMatchObject({ created: [], stocked: 0 });
    const after = data<{ data: { quantity: number }[] }>(
      await get('/inventory/stock?search=فلفل'),
    );
    expect(after.data).toMatchObject([{ quantity: 200 }]);
  });

  it('rejects invalid input with 400', async () => {
    const productId = await createProduct('مياه');
    const warehouseId = await mainWarehouseId();
    const adjust = (body: object) => post('/inventory/adjustments', body);

    expect(
      (
        await adjust({
          warehouseId,
          type: 'adjustment',
          lines: [{ productId, quantity: 0 }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await adjust({ warehouseId, type: 'adjustment', lines: [] })).status,
    ).toBe(400);
    // نوع حركة لا يُسمح بإدخاله يدوياً
    expect(
      (
        await adjust({
          warehouseId,
          type: 'sale',
          lines: [{ productId, quantity: -1 }],
        })
      ).status,
    ).toBe(400);
    expect(
      (await get('/inventory/stock/lookup?warehouseId=not-a-uuid')).status,
    ).toBe(400);
  });

  it('enforces the plan quota (max_warehouses)', async () => {
    await mainWarehouseId(); // المخزن الرئيسي يُحسب ضمن الحد

    expect(
      (await post('/inventory/warehouses', { name: 'فرع 1' })).status,
    ).toBe(201);
    expect(
      (await post('/inventory/warehouses', { name: 'فرع 2' })).status,
    ).toBe(403);
  });

  it('blocks the whole module when the plan lacks the feature', async () => {
    const noFeature = await createTenantFixture(dataSource, {
      features: ['products_module'],
    });

    const res = await get('/inventory/warehouses', noFeature.adminToken);

    expect(res.status).toBe(403);
  });

  it('checks permissions per action', async () => {
    const productId = await createProduct('مياه');
    const warehouseId = await mainWarehouseId();
    const viewer = tenant.tokenWith(['view_inventory']);
    const receiver = tenant.tokenWith([
      'view_inventory',
      'receive_stock_transfers',
    ]);

    expect((await get('/inventory/stock', viewer)).status).toBe(200);
    expect(
      (
        await post(
          '/inventory/adjustments',
          {
            warehouseId,
            type: 'adjustment',
            lines: [{ productId, quantity: 1 }],
          },
          viewer,
        )
      ).status,
    ).toBe(403);
    expect(
      (await post('/inventory/warehouses', { name: 'فرع' }, viewer)).status,
    ).toBe(403);
    // من يستلم التحويلات لا ينشئها
    expect(
      (
        await post(
          '/inventory/transfers',
          {
            fromWarehouseId: warehouseId,
            toWarehouseId: warehouseId,
            lines: [{ productId, quantity: 1 }],
          },
          receiver,
        )
      ).status,
    ).toBe(403);
  });

  it('refuses the system owner clearly instead of failing with 500', async () => {
    // مالك النظام يتجاوز الاشتراك والصلاحيات لكنه بلا شركة: كل الموديولات
    // التجارية تعمل على بيانات شركة فترفضه برسالة مفهومة
    const owner = systemOwnerToken();
    const paths = [
      '/inventory/warehouses',
      '/inventory/stock',
      '/catalog/products',
      '/purchasing/suppliers',
      '/sales/invoices',
      '/pos/devices',
    ];

    for (const path of paths) {
      const res = await get(path, owner);
      expect({ path, status: res.status }).toEqual({ path, status: 403 });
    }

    const create = await post('/inventory/warehouses', { name: 'فرع' }, owner);
    expect(create.status).toBe(403);
    expect((create.body as { message: string }).message).toContain(
      'خاصة بحسابات الشركات',
    );
  });

  it('keeps tenants isolated over HTTP', async () => {
    const other = await createTenantFixture(dataSource, { features: FEATURES });
    const productId = await createProduct('خاص بالشركة أ');
    const warehouseId = await mainWarehouseId();
    await post('/inventory/adjustments', {
      warehouseId,
      type: 'opening',
      lines: [{ productId, quantity: 5, unitCost: 1 }],
    });

    const levels = await get('/inventory/stock', other.adminToken);
    const steal = await post(
      '/inventory/adjustments',
      {
        warehouseId,
        type: 'adjustment',
        lines: [{ productId, quantity: -5 }],
      },
      other.adminToken,
    );

    expect(data<{ total: number }>(levels).total).toBe(0);
    expect(steal.status).toBe(404);
  });
});
