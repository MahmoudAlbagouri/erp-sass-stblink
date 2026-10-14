import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import type { PosBootstrap } from '../src/modules/pos/pos.service';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

interface Named {
  id: string;
  name: string;
}
interface Page<T> {
  data: T[];
  total: number;
}
interface ShiftRow {
  id: string;
  status: string;
  cashTotal: number;
  cardTotal: number;
  creditTotal: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  cashDifference: number;
}

/**
 * تحسينات الكاشير: البيع الآجل، حركات الدرج، سجل التدقيق، إضافة عميل من
 * الشاشة، العروض، وما ينزل للجهاز (الرصيد، أرصدة العملاء، الإعدادات).
 */
describe('POS enhancements (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  let productId: string;
  let warehouseId: string;
  let deviceId: string;
  let installationId: string;
  let deviceKey: string;
  let shiftId: string;
  let counter: number;

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
  const bootstrap = async (since?: string) =>
    data<PosBootstrap>(
      await api()
        .get(
          `/pos/device/bootstrap${since ? `?since=${encodeURIComponent(since)}` : ''}`,
        )
        .set(asDevice()),
    );
  const sync = async (...operations: object[]) =>
    data<{ results: { id: string; status: string; message?: string }[] }>(
      await api().post('/pos/device/sync').set(asDevice()).send({ operations }),
    ).results;

  /** بيع قطعة واحدة بـ 11.5 (10 + 1.5 ضريبة) */
  const sale = (extra: object = {}) => {
    counter += 1;
    return {
      id: `sale-${counter}`,
      type: 'sale',
      payload: {
        uuid: randomUUID(),
        number: `POS1-${String(counter).padStart(6, '0')}`,
        issuedAt: new Date().toISOString(),
        shiftId,
        pricesIncludeTax: true,
        lines: [
          {
            productId,
            quantity: 1,
            unitPrice: 11.5,
            discount: 0,
            taxRate: 15,
            subtotal: 10,
            taxAmount: 1.5,
            total: 11.5,
          },
        ],
        payments: [{ method: 'cash', amount: 11.5 }],
        ...extra,
      },
    };
  };
  const close = (closingCash: number) => ({
    id: `close-${shiftId}`,
    type: 'shift.close',
    payload: { id: shiftId, closedAt: new Date().toISOString(), closingCash },
  });
  const shift = async () =>
    data<Page<ShiftRow>>(await get('/pos/shifts')).data.find(
      (s) => s.id === shiftId,
    )!;

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
        'sales_module',
        'pos_module',
      ],
    });
    counter = 0;

    const units = data<Named[]>(await get('/catalog/units'));
    productId = data<Named>(
      await post('/catalog/products', {
        name: 'أرز 5 كجم',
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
      lines: [{ productId, quantity: 40, unitCost: 6 }],
    });
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
          openingCash: 100,
          cashierName: 'سالم',
        },
      }),
    ).toMatchObject([{ status: 'ok' }]);
  });

  afterAll(async () => {
    await app?.close();
  });

  // ══════════════════════════ ما ينزل للجهاز ══════════════════════════

  it('downloads stock, customer balances, promotions and options', async () => {
    const customer = data<Named>(
      await post('/sales/customers', {
        name: 'بقالة النخيل',
        creditLimit: 500,
        openingBalance: 120,
        paymentTermsDays: 30,
      }),
    );
    await post('/pos/cashiers', {
      name: 'مشرف',
      pin: '1234',
      isSupervisor: true,
      maxDiscountPercent: 10,
    });

    const first = await bootstrap();
    expect(first.stock).toEqual([{ productId, quantity: 40 }]);
    expect(first.customerBalances).toEqual([{ id: customer.id, balance: 120 }]);
    expect(first.customers).toMatchObject([
      { id: customer.id, creditLimit: 500, paymentTermsDays: 30 },
    ]);
    expect(first.cashiers).toMatchObject([
      { name: 'مشرف', isSupervisor: true, maxDiscountPercent: 10 },
    ]);
    expect(first.promotions).toEqual([]);
    // شركة لم تحفظ إعدادات: الافتراضي
    expect(first.posOptions).toMatchObject({
      scale: { enabled: false, itemDigits: 5, valueType: 'weight' },
      approvals: { void: false, cashOut: false, manualDrawer: false },
    });

    // بعد بيع: السحب التالي يحمل الرصيد الذي تغيّر فقط
    expect(await sync(sale())).toMatchObject([{ status: 'ok' }]);
    const next = await bootstrap(first.serverTime);
    expect(next.stock).toEqual([{ productId, quantity: 39 }]);
    expect((await bootstrap(next.serverTime)).stock).toEqual([]);
  });

  it('saves POS options with the billing settings and validates them', async () => {
    const options = {
      scale: {
        enabled: true,
        prefixes: ['21', '22'],
        itemDigits: 5,
        valueType: 'price',
        valueDecimals: 2,
      },
      approvals: { void: true, cashOut: true, manualDrawer: false },
    };
    expect(
      (await patch('/sales/settings', { posOptions: options })).status,
    ).toBe(200);
    // إعدادات شاشة أقدم بلا priceChange: لا تحتاج موافقة على تغيير السعر
    expect((await bootstrap()).posOptions).toEqual({
      ...options,
      approvals: { ...options.approvals, priceChange: false },
    });
    const priceApproval = {
      ...options,
      approvals: { ...options.approvals, priceChange: true },
    };
    expect(
      (await patch('/sales/settings', { posOptions: priceApproval })).status,
    ).toBe(200);
    expect((await bootstrap()).posOptions).toEqual(priceApproval);

    expect(
      (
        await patch('/sales/settings', {
          posOptions: {
            ...options,
            scale: { ...options.scale, prefixes: ['2'] },
          },
        })
      ).status,
    ).toBe(400);
  });

  // ══════════════════════════ البيع الآجل ══════════════════════════

  it('sells on account to a registered customer only', async () => {
    const customer = data<Named>(
      await post('/sales/customers', {
        name: 'مطعم الديوانية',
        paymentTermsDays: 15,
      }),
    );

    const results = await sync(
      // كله آجل
      sale({ customerId: customer.id, payments: [] }),
      // جزء نقدي والباقي آجل
      sale({
        customerId: customer.id,
        payments: [{ method: 'cash', amount: 5 }],
      }),
      // آجل بلا عميل: مرفوض
      sale({ payments: [] }),
      // مقبوض أكبر من الإجمالي: مرفوض
      sale({
        customerId: customer.id,
        payments: [{ method: 'cash', amount: 20 }],
      }),
    );
    expect(results.map((r) => r.status)).toEqual([
      'ok',
      'ok',
      'error',
      'error',
    ]);
    expect(results[2].message).toContain('لعميل مسجّل');

    const invoices = data<
      Page<{ id: string; number: string; remaining: number; dueDate: string }>
    >(await get('/sales/invoices'));
    const onAccount = invoices.data.find((i) => i.number === 'POS1-000001')!;
    expect(onAccount.remaining).toBe(11.5);
    // الاستحقاق = تاريخ البيع + مهلة العميل
    expect(onAccount.dueDate).not.toBe(new Date().toISOString().slice(0, 10));

    expect(await shift()).toMatchObject({
      cashTotal: 5,
      creditTotal: 18, // 11.5 + 6.5
      expectedCash: 105,
    });
    expect((await bootstrap()).customerBalances).toEqual([
      { id: customer.id, balance: 18 },
    ]);

    // قبضٌ لاحق من لوحة التحكم لا يدخل درج وردية البيع
    expect(
      (
        await post('/sales/payments', {
          invoiceId: onAccount.id,
          paymentDate: new Date().toISOString().slice(0, 10),
          amount: 11.5,
          method: 'cash',
        })
      ).status,
    ).toBe(201);
    expect(await shift()).toMatchObject({ cashTotal: 5, expectedCash: 105 });
  });

  // ══════════════════════════ حركات الدرج ══════════════════════════

  it('counts cash put in and taken out of the drawer', async () => {
    const move = (type: string, amount: number, reason: string) => ({
      id: `move-${randomUUID()}`,
      type: 'cash.move',
      payload: {
        id: randomUUID(),
        shiftId,
        type,
        amount,
        reason,
        occurredAt: new Date().toISOString(),
        approvedBy: type === 'out' ? 'المشرف خالد' : undefined,
      },
    });
    const withdrawal = move('out', 30, 'مصروف نثري: مياه');

    const results = await sync(
      sale(),
      move('in', 50, 'فكّة'),
      withdrawal,
      withdrawal, // رفع مكرر
      move('out', 0, 'صفر'), // مبلغ غير صالح
      {
        ...move('in', 5, 'وردية غريبة'),
        payload: { ...move('in', 5, 'x').payload, shiftId: randomUUID() },
      },
    );
    expect(results.map((r) => r.status)).toEqual([
      'ok',
      'ok',
      'ok',
      'duplicate',
      'error',
      'error',
    ]);

    // 100 عهدة + 11.5 بيع + 50 إيداع − 30 سحب
    expect(await shift()).toMatchObject({
      cashIn: 50,
      cashOut: 30,
      expectedCash: 131.5,
    });

    expect(await sync(close(131.5))).toMatchObject([{ status: 'ok' }]);
    expect(await shift()).toMatchObject({
      status: 'closed',
      cashIn: 50,
      cashOut: 30,
      expectedCash: 131.5,
      cashDifference: 0,
    });

    const listed = data<
      Page<{ type: string; amount: number; approvedBy: string | null }>
    >(await get(`/pos/cash-movements?shiftId=${shiftId}`));
    expect(listed.total).toBe(2);
    expect(listed.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'out',
          amount: 30,
          approvedBy: 'المشرف خالد',
        }),
        expect.objectContaining({ type: 'in', amount: 50 }),
      ]),
    );
    expect(
      (await get('/pos/cash-movements', tenant.tokenWith(['view_pos']))).status,
    ).toBe(403);
  });

  // ══════════════════════════ سجل التدقيق ══════════════════════════

  it('keeps an audit trail of what leaves no invoice behind', async () => {
    const event = (action: string, extra: object = {}) => ({
      id: `audit-${randomUUID()}`,
      type: 'audit',
      payload: {
        id: randomUUID(),
        action,
        occurredAt: new Date().toISOString(),
        shiftId,
        ...extra,
      },
    });
    const removed = event('line_removed', {
      amount: 11.5,
      details: 'أرز 5 كجم × 1',
      approvedBy: 'المشرف خالد',
    });

    const results = await sync(
      removed,
      removed,
      event('drawer_opened'),
      event('cart_cleared', { amount: 34.5, details: '3 أصناف' }),
      event('made_up_action'),
    );
    expect(results.map((r) => r.status)).toEqual([
      'ok',
      'duplicate',
      'ok',
      'ok',
      'error',
    ]);

    const all = data<
      Page<{
        action: string;
        cashierName: string;
        deviceName: string;
        approvedBy: string | null;
      }>
    >(await get('/pos/audit'));
    expect(all.total).toBe(3);
    // اسم الكاشير من الوردية إن لم يرسله الجهاز
    expect(all.data.every((row) => row.cashierName === 'سالم')).toBe(true);
    expect(all.data[0].deviceName).toBe('كاشير 1');

    const filtered = data<Page<{ action: string; approvedBy: string }>>(
      await get('/pos/audit?action=line_removed'),
    );
    expect(filtered.data).toMatchObject([
      { action: 'line_removed', approvedBy: 'المشرف خالد' },
    ]);

    const other = await createTenantFixture(dataSource, {
      features: ['pos_module', 'sales_module'],
    });
    expect(
      data<Page<unknown>>(await get('/pos/audit', other.adminToken)).total,
    ).toBe(0);
    expect(
      (await get('/pos/audit', tenant.tokenWith(['view_pos']))).status,
    ).toBe(403);
  });

  // ══════════════════════════ عميل من الشاشة ══════════════════════════

  it('creates a customer from the screen so its sales can refer to them', async () => {
    const id = randomUUID();
    const create = {
      id: `customer-${id}`,
      type: 'customer.create',
      payload: { id, name: 'عميل من الكاشير', phone: '0500000000' },
    };

    const results = await sync(
      create,
      sale({ customerId: id, payments: [] }),
      create,
    );
    expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'duplicate']);

    const customers = data<Page<Named & { code: string; balance: number }>>(
      await get('/sales/customers'),
    );
    expect(customers.data).toMatchObject([
      { id, name: 'عميل من الكاشير', code: 'CUS-000001', balance: 11.5 },
    ]);
  });

  // ══════════════════════════ العروض ══════════════════════════

  it('manages promotions and hands the live ones to the device', async () => {
    const day = 24 * 3600 * 1000;
    const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
    const create = (body: object) => post('/pos/promotions', body);

    const special = await create({
      name: 'سعر الأسبوع',
      type: 'special_price',
      productId,
      price: 9.5,
      startsAt: iso(-day),
      endsAt: iso(day),
    });
    expect(special.status).toBe(201);
    expect(
      (
        await create({
          name: 'اشترِ 2 واحصل على 1',
          type: 'buy_x_get_y',
          productId,
          buyQuantity: 2,
          getQuantity: 1,
        })
      ).status,
    ).toBe(201);
    // منتهٍ وموقوف: لا ينزلان
    await create({
      name: 'منتهٍ',
      type: 'percent_off',
      percent: 10,
      endsAt: iso(-day),
    });
    await create({
      name: 'موقوف',
      type: 'percent_off',
      percent: 5,
      isActive: false,
    });

    // حقول ناقصة لكل نوع
    expect(
      (await create({ name: 'بلا سعر', type: 'special_price', productId }))
        .status,
    ).toBe(400);
    expect(
      (
        await create({
          name: 'بلا صنف',
          type: 'buy_x_get_y',
          buyQuantity: 2,
          getQuantity: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (await create({ name: 'بلا نسبة', type: 'percent_off' })).status,
    ).toBe(400);
    expect(
      (
        await create({
          name: 'تواريخ معكوسة',
          type: 'percent_off',
          percent: 5,
          startsAt: iso(day),
          endsAt: iso(-day),
        })
      ).status,
    ).toBe(400);
    // صنف شركة أخرى
    const other = await createTenantFixture(dataSource, {
      features: ['pos_module', 'sales_module', 'products_module'],
    });
    expect(
      (
        await post(
          '/pos/promotions',
          { name: 'دخيل', type: 'special_price', productId, price: 1 },
          other.adminToken,
        )
      ).status,
    ).toBe(404);

    const onDevice = (await bootstrap()).promotions;
    expect(onDevice.map((p) => p.name)).toEqual([
      'سعر الأسبوع',
      'اشترِ 2 واحصل على 1',
    ]);
    expect(onDevice[0]).toMatchObject({
      type: 'special_price',
      price: 9.5,
      productId,
    });

    // تغيير النوع يُفرغ حقول النوع السابق
    const { id } = data<Named>(special);
    const changed = await patch(`/pos/promotions/${id}`, {
      type: 'percent_off',
      percent: 20,
    });
    expect(data(changed)).toMatchObject({
      type: 'percent_off',
      percent: 20,
      price: null,
    });

    expect(
      (
        await create({ name: 'x', type: 'percent_off', percent: 5 }).set(
          auth(tenant.tokenWith(['view_pos'])),
        )
      ).status,
    ).toBe(403);
    expect(
      data<unknown[]>(
        await get('/pos/promotions', tenant.tokenWith(['view_pos'])),
      ),
    ).toHaveLength(4);
  });
});
