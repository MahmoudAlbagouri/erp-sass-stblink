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
