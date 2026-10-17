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
 * المطاعم: الطاولات تنزل لشاشة الكاشير مع إعدادات المطبخ، وبونات المطبخ
 * ترفعها الشاشة في طابورها فتظهر على شاشة المطبخ وتتنقل بين حالاتها، والكاشير
 * يعرف الجاهز منها.
 */
describe('Restaurant: tables & kitchen (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  let productId: string;
  let categoryId: string;
  let deviceId: string;
  let installationId: string;
  let deviceKey: string;

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
  const deviceGet = (path: string) =>
    api().get(`/pos/device${path}`).set(asDevice());
  const devicePost = (path: string, body: object = {}) =>
    api().post(`/pos/device${path}`).set(asDevice()).send(body);
  const deviceSync = (operations: object[]) =>
    devicePost('/sync', { operations });
  const statuses = (res: request.Response) =>
    data<{ results: { status: string; message?: string }[] }>(res).results.map(
      (r) => r.message ?? r.status,
    );

  interface Ticket {
    id: string;
    ticketNo: number;
    status: string;
    tableName: string | null;
    lines: { name: string; quantity: number; note: string | null }[];
  }

  const ticket = (
    extra: Partial<Record<string, unknown>> & { orderRef: string },
  ) => {
    const id = randomUUID();
    return {
      id: `kitchen-${id}`,
      type: 'kitchen.send',
      payload: {
        id,
        ticketNo: 1,
        orderType: 'dine_in',
        round: 1,
        sentAt: new Date().toISOString(),
        cashierName: 'سارة',
        lines: [
          {
            productId,
            name: 'برجر لحم',
            unitName: 'قطعة',
            quantity: 2,
            note: 'بدون بصل',
          },
        ],
        ...extra,
      },
    };
  };

  const setup = async (features: string[]) => {
    tenant = await createTenantFixture(dataSource, { features });
    const units = data<{ id: string }[]>(await get('/catalog/units'));
    categoryId = data<{ id: string }>(
      await post('/catalog/categories', { name: 'مشويات' }),
    ).id;
    productId = data<{ id: string }>(
      await post('/catalog/products', {
        name: 'برجر لحم',
        baseUnitId: units[0].id,
        categoryId,
        salePrice: 45,
      }),
    ).id;
    const warehouseId = data<{ id: string; type: string }[]>(
      await get('/inventory/warehouses'),
    ).find((w) => w.type === 'main')!.id;
    deviceId = data<{ id: string }>(
      await post('/pos/devices', {
        name: 'كاشير الصالة',
        code: 'R1',
        warehouseId,
      }),
    ).id;
    installationId = randomUUID();
    deviceKey = data<{ deviceKey: string }>(
      await post(`/pos/devices/${deviceId}/bind`, { installationId }),
    ).deviceKey;
  };

  const FEATURES = [
    'products_module',
    'inventory_module',
    'sales_module',
    'pos_module',
    'restaurant_module',
  ];

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
  });

  afterAll(async () => {
    await app?.close();
  });

  it('manages tables and kitchen settings, and sends them to the cashier screen', async () => {
    await setup(FEATURES);

    const bulk = await post('/pos/restaurant/tables/bulk', {
      from: 1,
      to: 6,
      area: 'الصالة',
    });
    expect(data(bulk)).toEqual({ created: 6, skipped: 0 });
    // المكرر يُتخطّى
    expect(
      data(
        await post('/pos/restaurant/tables/bulk', {
          from: 5,
          to: 8,
          area: 'الصالة',
        }),
      ),
    ).toEqual({ created: 2, skipped: 2 });
    const vip = data<{ id: string; sortOrder: number }>(
      await post('/pos/restaurant/tables', {
        name: 'VIP 1',
        area: 'العائلات',
        seats: 8,
      }),
    );
    expect(
      (await post('/pos/restaurant/tables', { name: 'طاولة 3' })).status,
    ).toBe(409);
    expect(
      (await patch(`/pos/restaurant/tables/${vip.id}`, { isActive: false }))
        .status,
    ).toBe(200);
    expect(
      (await post('/pos/restaurant/tables/bulk', { from: 5, to: 1 })).status,
    ).toBe(400);

    const all = data<{ name: string }[]>(await get('/pos/restaurant/tables'));
    expect(all).toHaveLength(9);
    const removed = all.find((t) => t.name === 'طاولة 8') as unknown as {
      id: string;
    };
    expect(
      (
        await api()
          .delete(`/pos/restaurant/tables/${removed.id}`)
          .set(auth(tenant.adminToken))
      ).status,
    ).toBe(204);

    const settings = await patch('/pos/restaurant/settings', {
      kitchenCategoryIds: [categoryId],
      printKitchenTicket: false,
    });
    expect(settings.status).toBe(200);
    expect(
      (
        await patch('/pos/restaurant/settings', {
          kitchenCategoryIds: [randomUUID()],
        })
      ).status,
    ).toBe(400);

    // الشاشة: الطاولات الفعّالة (بلا الموقوفة والمحذوفة) وإعدادات المطبخ
    const boot = data<{
      restaurant: {
        tables: { name: string; area: string | null }[];
        kitchenCategoryIds: string[];
        printKitchenTicket: boolean;
        sendOnPayment: boolean;
      } | null;
    }>(await deviceGet('/bootstrap'));
    expect(boot.restaurant).toMatchObject({
      kitchenCategoryIds: [categoryId],
      printKitchenTicket: false,
      sendOnPayment: true,
    });
    expect(boot.restaurant!.tables.map((t) => t.name)).toEqual([
      'طاولة 1',
      'طاولة 2',
      'طاولة 3',
      'طاولة 4',
      'طاولة 5',
      'طاولة 6',
      'طاولة 7',
    ]);
  });

  it('moves kitchen tickets from the cashier screen through the kitchen display', async () => {
    await setup(FEATURES);
    const orderRef = randomUUID();
    const first = ticket({ orderRef, tableName: 'طاولة 4' });

    expect(statuses(await deviceSync([first]))).toEqual(['ok']);
    // رفع مكرر (الشاشة لم تستلم الرد)
    expect(statuses(await deviceSync([first]))).toEqual(['duplicate']);
    // بون بلا أصناف يُرفض
    expect(
      statuses(await deviceSync([ticket({ orderRef, lines: [] })]))[0],
    ).not.toBe('ok');

    const kitchen = tenant.tokenWith(['use_kitchen_display']);
    let board = data<Ticket[]>(await get('/pos/kitchen/orders', kitchen));
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({
      status: 'new',
      tableName: 'طاولة 4',
      lines: [{ name: 'برجر لحم', quantity: 2, note: 'بدون بصل' }],
    });
    const id = board[0].id;

    // إضافة على نفس الطاولة وإلغاء صنف (كمية سالبة)
    const second = ticket({
      orderRef,
      ticketNo: 2,
      round: 2,
      tableName: 'طاولة 4',
      lines: [{ name: 'برجر لحم', quantity: -1 }],
    });
    expect(statuses(await deviceSync([second]))).toEqual(['ok']);

    // لا قفز من جديد إلى سُلّم، ومن لا يملك الصلاحية لا ينقل
    expect(
      (await patch(`/pos/kitchen/orders/${id}`, { status: 'served' }, kitchen))
        .status,
    ).toBe(400);
    expect(
      (
        await patch(
          `/pos/kitchen/orders/${id}`,
          { status: 'preparing' },
          tenant.tokenWith(['view_pos']),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await patch(
          `/pos/kitchen/orders/${id}`,
          { status: 'preparing' },
          kitchen,
        )
      ).status,
    ).toBe(200);
    const ready = await patch(
      `/pos/kitchen/orders/${id}`,
      { status: 'ready' },
      kitchen,
    );
    const readyTicket = data<{ status: string; readyAt: string | null }>(ready);
    expect(readyTicket.status).toBe('ready');
    expect(readyTicket.readyAt).toBeTruthy();

    // الكاشير يعرف الجاهز
    const mine = data<{ id: string; status: string }[]>(
      await deviceGet('/kitchen'),
    );
    expect(mine.map((t) => t.status).sort()).toEqual(['new', 'ready']);

    // الطاولة دفعت: الجاهز سُلّم، وما لم يجهز يبقى للمطبخ
    expect(
      statuses(
        await deviceSync([
          {
            id: `close-${orderRef}`,
            type: 'kitchen.close',
            payload: { orderRef, closedAt: new Date().toISOString() },
          },
        ]),
      ),
    ).toEqual(['ok']);
    board = data<Ticket[]>(await get('/pos/kitchen/orders', kitchen));
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({
      status: 'new',
      lines: [{ quantity: -1 }],
    });

    // الكاشير يستلم الثاني بنفسه
    const secondId = board[0].id;
    await patch(
      `/pos/kitchen/orders/${secondId}`,
      { status: 'ready' },
      kitchen,
    );
    expect((await devicePost(`/kitchen/${secondId}/served`)).status).toBe(200);
    expect(
      data<Ticket[]>(await get('/pos/kitchen/orders', kitchen)),
    ).toHaveLength(0);
    expect(data<unknown[]>(await deviceGet('/kitchen'))).toHaveLength(0);
  });

  it('is off for plans without the restaurant module', async () => {
    await setup(FEATURES.filter((f) => f !== 'restaurant_module'));
    const boot = data<{ restaurant: unknown }>(await deviceGet('/bootstrap'));
    expect(boot.restaurant).toBeNull();
    expect((await get('/pos/restaurant/tables')).status).toBe(403);
    expect((await get('/pos/kitchen/orders')).status).toBe(403);
  });
});
