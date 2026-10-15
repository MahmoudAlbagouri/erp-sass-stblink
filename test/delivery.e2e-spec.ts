import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * التوصيل والشحن عبر الـ HTTP: أوردر يخرج مع طيار ويُسلَّم ويُسوّى، أوردر
 * مدفوع مقدماً مع شركة شحن لا يُسلَّم فيرجع، والإلغاء قبل الخروج.
 */
describe('Delivery API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  const FEATURES = [
    'products_module',
    'inventory_module',
    'sales_module',
    'delivery_module',
  ];

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

  const get = (path: string, token = tenant.adminToken) =>
    api().get(path).set(auth(token));
  const post = (path: string, body: object = {}, token = tenant.adminToken) =>
    api().post(path).set(auth(token)).send(body);

  interface Order {
    id: string;
    number: string;
    status: string;
    codAmount: number;
    agentFee: number;
    deliveryFee: number;
    settlementId: string | null;
    returnId: string | null;
    invoice: {
      id: string;
      status: string;
      total: number;
      paidAmount: number;
      returnedAmount: number;
    };
  }

  /** صنف عليه 50 قطعة في المخزن الرئيسي */
  const setup = async () => {
    const units = data<{ id: string }[]>(await get('/catalog/units'));
    const product = await post('/catalog/products', {
      name: 'عطر 100 مل',
      baseUnitId: units[0].id,
      salePrice: 100,
    });
    expect(product.status).toBe(201);
    const productId = data<{ id: string }>(product).id;
    const warehouses = data<{ id: string; type: string }[]>(
      await get('/inventory/warehouses'),
    );
    const warehouseId = warehouses.find((w) => w.type === 'main')!.id;
    await post('/inventory/adjustments', {
      warehouseId,
      type: 'opening',
      lines: [{ productId, quantity: 50, unitCost: 40 }],
    });
    return { productId, warehouseId };
  };

  const stockOf = async (productId: string) => {
    const levels = data<{ data: { productId: string; quantity: number }[] }>(
      await get('/inventory/stock'),
    );
    return levels.data.find((l) => l.productId === productId)?.quantity;
  };

  const orderBody = (
    warehouseId: string,
    productId: string,
    extra: object = {},
  ) => ({
    warehouseId,
    recipientName: 'أحمد علي',
    phone: '0500000001',
    address: 'حي النرجس، شارع 12',
    paymentMode: 'cod',
    lines: [{ productId, quantity: 2, unitPrice: 100 }],
    ...extra,
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

  it('runs a cash-on-delivery order from creation to the driver settlement', async () => {
    const { productId, warehouseId } = await setup();
    const driver = data<{ id: string }>(
      await post('/delivery/agents', {
        type: 'driver',
        name: 'محمود الطيار',
        phone: '0550000000',
        defaultFee: 10,
      }),
    );
    const zone = data<{ id: string }>(
      await post('/delivery/zones', {
        name: 'شمال الرياض',
        fee: 15,
        estimatedMinutes: 45,
      }),
    );

    const created = await post(
      '/delivery/orders',
      orderBody(warehouseId, productId, {
        zoneId: zone.id,
        agentId: driver.id,
      }),
    );
    expect(created.status).toBe(201);
    const order = data<Order & { invoice: { lines?: unknown[] } }>(created);
    expect(order).toMatchObject({
      number: 'DLV-000001',
      status: 'assigned',
      deliveryFee: 15,
      agentFee: 10,
      invoice: { status: 'draft' },
    });
    // سطر الأصناف + سطر رسوم التوصيل
    const invoice = data<{
      total: number;
      isDelivery: boolean;
      lines: { productName: string; isStocked: boolean }[];
    }>(await get(`/sales/invoices/${order.invoice.id}`));
    expect(invoice.isDelivery).toBe(true);
    expect(invoice.lines).toHaveLength(2);
    expect(invoice.lines[1]).toMatchObject({
      productName: 'رسوم التوصيل',
      isStocked: false,
    });
    expect(order.codAmount).toBe(invoice.total);

    // فاتورة الأوردر لا تُصدر ولا تُلغى من شاشة المبيعات
    const direct = await post(`/sales/invoices/${order.invoice.id}/issue`, {});
    expect(direct.status).toBe(400);
    expect(
      (
        await post(`/sales/invoices/${order.invoice.id}/cancel`)
      ).status,
    ).toBe(400);

    // الخروج: تصدر الفاتورة وتخرج البضاعة، والمبلغ على الطيار
    const out = data<Order>(
      await post(`/delivery/orders/${order.id}/dispatch`),
    );
    expect(out.status).toBe('out_for_delivery');
    expect(out.invoice).toMatchObject({
      status: 'issued',
      paidAmount: invoice.total,
    });
    expect(await stockOf(productId)).toBe(48);

    // ضغطة خروج ثانية لا تُخرجه مرة أخرى
    expect((await post(`/delivery/orders/${order.id}/dispatch`)).status).toBe(
      400,
    );

    const payments = data<{ data: { method: string; amount: number }[] }>(
      await get(`/sales/payments?invoiceId=${order.invoice.id}`),
    );
    expect(payments.data).toMatchObject([
      { method: 'courier', amount: invoice.total },
    ]);

    expect(
      data<Order>(await post(`/delivery/orders/${order.id}/deliver`)).status,
    ).toBe('delivered');

    const agents = data<{ id: string; heldAmount: number }[]>(
      await get('/delivery/agents'),
    );
    expect(agents[0]).toMatchObject({
      heldAmount: invoice.total,
      unsettledCount: 1,
    });
    const summary = data<{
      counts: Record<string, number>;
      heldTotal: number;
    }>(await get('/delivery/summary'));
    expect(summary.counts.delivered).toBe(1);
    expect(summary.heldTotal).toBe(invoice.total);

    // التسوية: الطيار يسلّم المحصّل ناقص أجرته
    const settled = await post('/delivery/settlements', {
      agentId: driver.id,
      orderIds: [order.id],
      receivedAmount: invoice.total - 10,
      method: 'cash',
    });
    expect(settled.status).toBe(201);
    expect(data(settled)).toMatchObject({
      number: 'DST-000001',
      ordersCount: 1,
      collectedTotal: invoice.total,
      feesTotal: 10,
      expectedAmount: invoice.total - 10,
      difference: 0,
    });

    // لا تُسوّى مرتين، ولا مال بعدها مع الطيار
    const again = await post('/delivery/settlements', {
      agentId: driver.id,
      orderIds: [order.id],
      receivedAmount: 0,
      method: 'cash',
    });
    expect(again.status).toBe(400);
    expect(
      data<{ heldAmount: number }>(await get(`/delivery/agents/${driver.id}`))
        .heldAmount,
    ).toBe(0);
  });

  it('returns a prepaid carrier order that was not delivered', async () => {
    const { productId, warehouseId } = await setup();
    const carrier = data<{ id: string }>(
      await post('/delivery/agents', {
        type: 'carrier',
        name: 'شركة الشحن السريع',
        defaultFee: 25,
        codFeePercent: 1,
      }),
    );

    // المدفوع مقدماً يحتاج طريقة الدفع
    expect(
      (
        await post(
          '/delivery/orders',
          orderBody(warehouseId, productId, { paymentMode: 'prepaid' }),
        )
      ).status,
    ).toBe(400);
    // "courier" لا تُختار يدوياً
    expect(
      (
        await post(
          '/delivery/orders',
          orderBody(warehouseId, productId, {
            paymentMode: 'prepaid',
            prepaidMethod: 'courier',
          }),
        )
      ).status,
    ).toBe(400);

    const order = data<Order>(
      await post(
        '/delivery/orders',
        orderBody(warehouseId, productId, {
          paymentMode: 'prepaid',
          prepaidMethod: 'card',
        }),
      ),
    );
    expect(order).toMatchObject({ status: 'new', codAmount: 0 });

    // لا يخرج قبل إسناده
    expect((await post(`/delivery/orders/${order.id}/dispatch`)).status).toBe(
      400,
    );
    const assigned = data<Order>(
      await post(`/delivery/orders/${order.id}/assign`, {
        agentId: carrier.id,
        trackingNumber: 'AWB-123',
      }),
    );
    // مدفوع مقدماً: لا تحصيل، فلا نسبة تحصيل
    expect(assigned).toMatchObject({ status: 'assigned', agentFee: 25 });

    await post(`/delivery/orders/${order.id}/dispatch`);
    expect(await stockOf(productId)).toBe(48);

    expect(
      (await post(`/delivery/orders/${order.id}/fail`, {})).status,
    ).toBe(400); // السبب إجباري
    const failed = data<Order>(
      await post(`/delivery/orders/${order.id}/fail`, {
        reason: 'العميل رفض الاستلام',
      }),
    );
    expect(failed.status).toBe('failed');
    expect(failed.returnId).toBeTruthy();
    expect(failed.invoice.returnedAmount).toBe(failed.invoice.total);
    expect(failed.invoice.paidAmount).toBe(0);
    expect(await stockOf(productId)).toBe(50);

    // شركة الشحن: لا محصّل، ورسوم المشوار علينا (المتوقع سالب)
    const settlement = data<{
      collectedTotal: number;
      expectedAmount: number;
      difference: number;
    }>(
      await post('/delivery/settlements', {
        agentId: carrier.id,
        orderIds: [order.id],
        receivedAmount: -25,
        method: 'bank_transfer',
      }),
    );
    expect(settlement).toMatchObject({
      collectedTotal: 0,
      expectedAmount: -25,
      difference: 0,
    });
  });

  it('cancels an order before dispatch and blocks deleting a busy agent', async () => {
    const { productId, warehouseId } = await setup();
    const driver = data<{ id: string }>(
      await post('/delivery/agents', { type: 'driver', name: 'سعيد' }),
    );
    const order = data<Order>(
      await post(
        '/delivery/orders',
        orderBody(warehouseId, productId, { agentId: driver.id }),
      ),
    );

    const busy = await api()
      .delete(`/delivery/agents/${driver.id}`)
      .set(auth(tenant.adminToken));
    expect(busy.status).toBe(400);

    const cancelled = data<Order>(
      await post(`/delivery/orders/${order.id}/cancel`),
    );
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.invoice.status).toBe('cancelled');
    expect(await stockOf(productId)).toBe(50);
    expect((await post(`/delivery/orders/${order.id}/dispatch`)).status).toBe(
      400,
    );

    const list = data<{ total: number }>(
      await get('/delivery/orders?status=cancelled'),
    );
    expect(list.total).toBe(1);
    expect(
      (
        await api()
          .delete(`/delivery/agents/${driver.id}`)
          .set(auth(tenant.adminToken))
      ).status,
    ).toBe(200);
  });

  it('dispatches once when two requests race', async () => {
    const { productId, warehouseId } = await setup();
    const driver = data<{ id: string }>(
      await post('/delivery/agents', { type: 'driver', name: 'علي' }),
    );
    const order = data<Order>(
      await post(
        '/delivery/orders',
        orderBody(warehouseId, productId, { agentId: driver.id }),
      ),
    );

    const results = await Promise.all([
      post(`/delivery/orders/${order.id}/dispatch`),
      post(`/delivery/orders/${order.id}/dispatch`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await stockOf(productId)).toBe(48);
  });

  it('rejects courier as a manual payment method', async () => {
    const res = await post('/sales/payments', {
      amount: 10,
      method: 'courier',
      paymentDate: '2026-10-15',
    });
    expect(res.status).toBe(400);
  });

  it('is hidden from tenants without the delivery module', async () => {
    tenant = await createTenantFixture(dataSource, {
      features: FEATURES.filter((f) => f !== 'delivery_module'),
    });
    expect((await get('/delivery/orders')).status).toBe(403);
  });
});
