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
 * التوصيل من شاشة الكاشير (فاتورة تُباع وتُطبع، ربما بلا إنترنت، ثم يُنشأ
 * أوردرها عند رفعها) وشاشة الطيار على جواله برابطه.
 */
describe('Delivery from POS and the driver screen (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  const FEATURES = [
    'products_module',
    'inventory_module',
    'sales_module',
    'pos_module',
    'delivery_module',
  ];

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
  const get = (path: string) => api().get(path).set(auth(tenant.adminToken));
  const post = (path: string, body: object = {}) =>
    api().post(path).set(auth(tenant.adminToken)).send(body);

  interface Order {
    id: string;
    number: string;
    status: string;
    source: string;
    codAmount: number;
    paymentMode: string;
    prepaidMethod: string | null;
    agentId: string | null;
    returnId: string | null;
    invoice: { id: string; status: string; total: number; paidAmount: number };
  }

  /** صنف عليه 50، جهاز كاشير مربوط، طيار، ووردية مفتوحة */
  const setup = async () => {
    const units = data<{ id: string }[]>(await get('/catalog/units'));
    const productId = data<{ id: string }>(
      await post('/catalog/products', {
        name: 'مياه 330 مل',
        baseUnitId: units[0].id,
        salePrice: 2.3,
      }),
    ).id;
    const warehouseId = data<{ id: string; type: string }[]>(
      await get('/inventory/warehouses'),
    ).find((w) => w.type === 'main')!.id;
    await post('/inventory/adjustments', {
      warehouseId,
      type: 'opening',
      lines: [{ productId, quantity: 50, unitCost: 1 }],
    });
    const deviceId = data<{ id: string }>(
      await post('/pos/devices', {
        name: 'كاشير 1',
        code: 'POS1',
        warehouseId,
      }),
    ).id;
    const installationId = randomUUID();
    await post(`/pos/devices/${deviceId}/bind`, { installationId });
    const driver = data<{ id: string }>(
      await post('/delivery/agents', {
        type: 'driver',
        name: 'محمود',
        defaultFee: 5,
      }),
    );

    const shiftId = randomUUID();
    await post('/pos/sync', {
      deviceId,
      installationId,
      operations: [
        {
          id: 'open',
          type: 'shift.open',
          payload: {
            id: shiftId,
            openedAt: '2026-10-15T05:00:00.000Z',
            openingCash: 0,
          },
        },
      ],
    });
    return {
      productId,
      warehouseId,
      deviceId,
      installationId,
      shiftId,
      driver,
    };
  };

  /** فاتورة توصيل: صنفان × 2.3 + رسوم توصيل 11.5 (شاملة 15%) = 16.1 */
  const deliverySale = (
    ctx: Awaited<ReturnType<typeof setup>>,
    feeProductId: string,
    counter: number,
    extra: { payments?: object[]; delivery?: object | null } = {},
  ) => ({
    id: `sale-${counter}`,
    type: 'sale',
    payload: {
      uuid: randomUUID(),
      number: `POS1-${String(counter).padStart(6, '0')}`,
      issuedAt: '2026-10-15T08:00:00.000Z',
      shiftId: ctx.shiftId,
      pricesIncludeTax: true,
      lines: [
        {
          productId: ctx.productId,
          quantity: 2,
          unitPrice: 2.3,
          discount: 0,
          taxRate: 15,
          subtotal: 4,
          taxAmount: 0.6,
          total: 4.6,
        },
        {
          productId: feeProductId,
          quantity: 1,
          unitPrice: 11.5,
          discount: 0,
          taxRate: 15,
          subtotal: 10,
          taxAmount: 1.5,
          total: 11.5,
        },
      ],
      payments: extra.payments ?? [{ method: 'courier', amount: 16.1 }],
      ...(extra.delivery === null
        ? {}
        : {
            delivery: extra.delivery ?? {
              recipientName: 'خالد',
              phone: '0501234567',
              address: 'حي الملقا',
              deliveryFee: 11.5,
              agentId: ctx.driver.id,
              dispatchNow: true,
            },
          }),
    },
  });

  const sync = (ctx: Awaited<ReturnType<typeof setup>>, operations: object[]) =>
    post('/pos/sync', {
      deviceId: ctx.deviceId,
      installationId: ctx.installationId,
      operations,
    });

  const feeProductOf = async (ctx: Awaited<ReturnType<typeof setup>>) => {
    const boot = data<{
      delivery: { feeProductId: string; agents: { id: string }[] } | null;
    }>(
      await get(
        `/pos/bootstrap?deviceId=${ctx.deviceId}&installationId=${ctx.installationId}`,
      ),
    );
    expect(boot.delivery?.agents).toMatchObject([{ id: ctx.driver.id }]);
    return boot.delivery!.feeProductId;
  };

  const stockOf = async (productId: string) =>
    data<{ data: { productId: string; quantity: number }[] }>(
      await get('/inventory/stock'),
    ).data.find((l) => l.productId === productId)?.quantity;

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

  it('turns a POS delivery sale into an order already out with the driver', async () => {
    const ctx = await setup();
    const feeProductId = await feeProductOf(ctx);

    const sale = deliverySale(ctx, feeProductId, 1);
    // نفس الفاتورة مرتين (إعادة رفع بعد انقطاع): أوردر واحد
    const synced = data<{ results: { status: string }[] }>(
      await sync(ctx, [sale, sale]),
    );
    expect(synced.results.map((r) => r.status)).toEqual(['ok', 'duplicate']);

    const orders = data<{ total: number; data: Order[] }>(
      await get('/delivery/orders'),
    );
    expect(orders.total).toBe(1);
    expect(orders.data[0]).toMatchObject({
      source: 'pos',
      status: 'out_for_delivery',
      paymentMode: 'cod',
      codAmount: 16.1,
      agentId: ctx.driver.id,
      invoice: { status: 'issued', total: 16.1, paidAmount: 16.1 },
    });
    expect(await stockOf(ctx.productId)).toBe(48);

    // التحصيل على الطيار لا في درج الوردية
    const shift = data<{
      data: { expectedCash?: number; salesTotal: number }[];
    }>(await get('/pos/shifts')).data[0];
    expect(shift.salesTotal).toBe(16.1);

    const id = orders.data[0].id;
    await post(`/delivery/orders/${id}/deliver`);
    expect(
      data<{ heldAmount: number }>(
        await get(`/delivery/agents/${ctx.driver.id}`),
      ).heldAmount,
    ).toBe(16.1);
  });

  it('dispatches a POS order without re-issuing, and cancels one with a full return', async () => {
    const ctx = await setup();
    const feeProductId = await feeProductOf(ctx);
    await sync(ctx, [
      // مدفوع نقداً عند الكاشير، بلا طيار بعد
      deliverySale(ctx, feeProductId, 1, {
        payments: [{ method: 'cash', amount: 16.1 }],
        delivery: {
          recipientName: 'سارة',
          phone: '0509998888',
          address: 'حي الروضة',
          deliveryFee: 11.5,
        },
      }),
      deliverySale(ctx, feeProductId, 2),
    ]);
    const all = data<{ data: Order[] }>(await get('/delivery/orders')).data;
    const prepaid = all.find((o) => o.paymentMode === 'prepaid')!;
    expect(prepaid).toMatchObject({
      status: 'new',
      prepaidMethod: 'cash',
      codAmount: 0,
    });

    await post(`/delivery/orders/${prepaid.id}/assign`, {
      agentId: ctx.driver.id,
    });
    const out = await post(`/delivery/orders/${prepaid.id}/dispatch`);
    expect(out.status).toBe(200);
    expect(data<Order>(out)).toMatchObject({
      status: 'out_for_delivery',
      invoice: { status: 'issued', paidAmount: 16.1 },
    });
    expect(await stockOf(ctx.productId)).toBe(46);

    // أوردر كاشير لم يخرج يُلغى بمرتجع كامل (فاتورته صدرت عند البيع)
    const cod = all.find((o) => o.paymentMode === 'cod')!;
    await post(`/delivery/orders/${cod.id}/fail`, { reason: 'x' }); // خرج: يُرفض الإلغاء ويُقبل عدم التسليم
    const third = data<{ data: Order[] }>(await get('/delivery/orders')).data;
    expect(third.find((o) => o.id === cod.id)!.status).toBe('failed');
    expect(await stockOf(ctx.productId)).toBe(48);

    await sync(ctx, [
      deliverySale(ctx, feeProductId, 3, {
        delivery: {
          recipientName: 'علي',
          phone: '0500000000',
          address: 'حي النخيل',
          agentId: ctx.driver.id,
        },
      }),
    ]);
    const assigned = data<{ data: Order[] }>(
      await get('/delivery/orders?status=assigned'),
    ).data[0];
    const cancelled = data<Order>(
      await post(`/delivery/orders/${assigned.id}/cancel`),
    );
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.returnId).toBeTruthy();
    expect(cancelled.invoice.paidAmount).toBe(0);
    expect(await stockOf(ctx.productId)).toBe(48);
  });

  it('rejects courier payments on a POS sale without delivery details', async () => {
    const ctx = await setup();
    const feeProductId = await feeProductOf(ctx);
    const synced = data<{ results: { status: string; error?: string }[] }>(
      await sync(ctx, [deliverySale(ctx, feeProductId, 1, { delivery: null })]),
    );
    expect(synced.results[0].status).not.toBe('ok');
    expect(data<{ total: number }>(await get('/sales/invoices')).total).toBe(0);
  });

  it('lets a driver work his own orders from his phone link', async () => {
    const ctx = await setup();
    const other = data<{ id: string }>(
      await post('/delivery/agents', { type: 'driver', name: 'سعيد' }),
    );
    const carrier = data<{ id: string }>(
      await post('/delivery/agents', { type: 'carrier', name: 'سمسا' }),
    );
    const order = (agentId: string) =>
      post('/delivery/orders', {
        warehouseId: ctx.warehouseId,
        recipientName: 'أحمد',
        phone: '0501111111',
        address: 'حي الياسمين',
        paymentMode: 'cod',
        agentId,
        lines: [{ productId: ctx.productId, quantity: 1, unitPrice: 2.3 }],
      });
    const mine = data<Order>(await order(ctx.driver.id));
    const notMine = data<Order>(await order(other.id));

    // شركة الشحن لا شاشة لها
    expect(
      (await post(`/delivery/agents/${carrier.id}/driver-access`)).status,
    ).toBe(400);
    const access = data<{ agentId: string; key: string }>(
      await post(`/delivery/agents/${ctx.driver.id}/driver-access`),
    );
    const driver = (method: 'get' | 'post', path: string, body: object = {}) =>
      api()
        [method](`/delivery/driver${path}`)
        .set({ 'X-Driver-Agent': access.agentId, 'X-Driver-Key': access.key })
        .send(body);

    const board = data<{ agent: { name: string }; orders: Order[] }>(
      await driver('get', '/board'),
    );
    expect(board.agent.name).toBe('محمود');
    expect(board.orders.map((o) => o.id)).toEqual([mine.id]);

    // أوردر طيار آخر: كأنه غير موجود
    expect((await driver('post', `/orders/${notMine.id}/pickup`)).status).toBe(
      404,
    );

    const picked = data<Order>(
      await driver('post', `/orders/${mine.id}/pickup`),
    );
    expect(picked).toMatchObject({
      status: 'out_for_delivery',
      invoice: { status: 'issued' },
    });
    expect(
      data<Order>(await driver('post', `/orders/${mine.id}/deliver`)).status,
    ).toBe('delivered');
    expect(
      data<{ agent: { heldAmount: number } }>(await driver('get', '/board'))
        .agent.heldAmount,
    ).toBe(2.3);

    // رابط بلا مفتاح صحيح، ورابط أُبطل
    expect(
      (
        await api()
          .get('/delivery/driver/board')
          .set({ 'X-Driver-Agent': access.agentId, 'X-Driver-Key': 'wrong' })
      ).status,
    ).toBe(401);
    await api()
      .delete(`/delivery/agents/${ctx.driver.id}/driver-access`)
      .set(auth(tenant.adminToken));
    expect((await driver('get', '/board')).status).toBe(401);
  });

  it('syncs what the driver did offline: in order, once, at the time it happened', async () => {
    const ctx = await setup();
    const order = async () =>
      data<Order>(
        await post('/delivery/orders', {
          warehouseId: ctx.warehouseId,
          recipientName: 'أحمد',
          phone: '0501111111',
          address: 'حي الياسمين',
          paymentMode: 'cod',
          agentId: ctx.driver.id,
          lines: [{ productId: ctx.productId, quantity: 1, unitPrice: 2.3 }],
        }),
      );
    const delivered = await order();
    const failed = await order();
    const cancelled = await order();
    const reassigned = await order();
    const early = await order();
    // أُسندت قبل ثلاث ساعات: أحداث الجوال بعدها
    await dataSource.query(
      `UPDATE delivery_orders SET "assignedAt" = now() - interval '3 hours'`,
    );
    const other = data<{ id: string }>(
      await post('/delivery/agents', { type: 'driver', name: 'سعيد' }),
    );
    const access = data<{ agentId: string; key: string }>(
      await post(`/delivery/agents/${ctx.driver.id}/driver-access`),
    );
    const driverHeaders = {
      'X-Driver-Agent': access.agentId,
      'X-Driver-Key': access.key,
    };
    const sync = (operations: object[]) =>
      api()
        .post('/delivery/driver/sync')
        .set(driverHeaders)
        .send({ operations });

    // والطيار بلا إنترنت: المدير ألغى أوردراً وأسند آخر لغيره
    await post(`/delivery/orders/${cancelled.id}/cancel`);
    await post(`/delivery/orders/${reassigned.id}/assign`, {
      agentId: other.id,
    });

    const minutesAgo = (minutes: number) =>
      new Date(Date.now() - minutes * 60_000).toISOString();
    const op = (
      type: string,
      orderId: string,
      minutes: number,
      reason?: string,
    ) => ({
      id: randomUUID(),
      type,
      orderId,
      occurredAt: minutesAgo(minutes),
      ...(reason ? { reason } : {}),
    });
    const operations = [
      op('pickup', delivered.id, 90),
      op('pickup', failed.id, 90),
      op('deliver', delivered.id, 60),
      op('fail', failed.id, 45, 'العميل لا يرد'),
      op('pickup', cancelled.id, 80),
      op('pickup', reassigned.id, 80),
      // ساعة الجوال متقدمة نصف ساعة: لا يُسجَّل وقت في المستقبل
      op('pickup', early.id, -30),
    ];

    type Results = { results: { status: string; message?: string }[] };
    const first = data<Results>(await sync(operations));
    expect(first.results.map((r) => r.status)).toEqual([
      'ok',
      'ok',
      'ok',
      'ok',
      'error',
      'error',
      'ok',
    ]);
    expect(first.results[4].message).toContain('أُلغي');
    expect(first.results[5].message).toContain('لم يعد مسنداً لك');

    type Timed = Order & {
      dispatchedAt: string;
      deliveredAt: string | null;
      failedAt: string | null;
      failReason: string | null;
    };
    const at = (value: string | null) => new Date(value!).toISOString();

    // أوقات الجوال لا وقت الرفع — والفاتورة صدرت لحظة الخروج
    const done = data<Timed>(await get(`/delivery/orders/${delivered.id}`));
    expect(done.status).toBe('delivered');
    expect(at(done.dispatchedAt)).toBe(operations[0].occurredAt);
    expect(at(done.deliveredAt)).toBe(operations[2].occurredAt);
    const invoice = data<{ issuedAt: string }>(
      await get(`/sales/invoices/${done.invoice.id}`),
    );
    expect(at(invoice.issuedAt)).toBe(operations[0].occurredAt);

    const back = data<Timed>(await get(`/delivery/orders/${failed.id}`));
    expect(back).toMatchObject({
      status: 'failed',
      failReason: 'العميل لا يرد',
    });
    expect(back.returnId).toBeTruthy();
    expect(at(back.failedAt)).toBe(operations[3].occurredAt);

    const future = data<Timed>(await get(`/delivery/orders/${early.id}`));
    expect(new Date(future.dispatchedAt).getTime()).toBeLessThanOrEqual(
      Date.now(),
    );

    // 50 − المسلَّم − الخارج الآن (الراجع عاد، والملغي لم يخرج)
    expect(await stockOf(ctx.productId)).toBe(48);

    // نفس الرفع مرة ثانية (انقطع الاتصال قبل الرد): لا شيء يتكرر
    const again = data<Results>(await sync(operations));
    expect(again.results.map((r) => r.status)).toEqual([
      'duplicate',
      'duplicate',
      'duplicate',
      'duplicate',
      'error',
      'error',
      'duplicate',
    ]);
    expect(await stockOf(ctx.productId)).toBe(48);
    expect(
      data<{ agent: { heldAmount: number } }>(
        await api().get('/delivery/driver/board').set(driverHeaders),
      ).agent.heldAmount,
    ).toBe(2.3);

    // "لم يُسلَّم" بلا سبب: الدفعة كلها مرفوضة
    expect(
      (await sync([{ ...op('fail', early.id, 1), reason: '' }])).status,
    ).toBe(400);
  });
});
