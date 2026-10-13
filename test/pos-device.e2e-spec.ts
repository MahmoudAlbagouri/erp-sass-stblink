import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { pbkdf2Sync, randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { SubscriptionStatus } from '../src/common/enums/subscription.enums';
import { PosShift } from '../src/modules/pos/entities/pos.entity';
import { Subscription } from '../src/modules/subscriptions/entities/subscription.entity';
import { Tenant } from '../src/modules/tenants/entities/tenant.entity';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * شاشة الكاشير بهوية جهازها: بعد الربط تسحب وترفع بمفتاح الجهاز دون جلسة
 * مستخدم، والورديات تُفتح بكاشير له رقم سري.
 */
describe('POS device identity & cashiers (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  let productId: string;
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

  /** ترويسات الشاشة: هوية الجهاز فقط، بلا توكن مستخدم */
  const asDevice = (overrides: Record<string, string> = {}) => ({
    'x-pos-device': deviceId,
    'x-pos-key': deviceKey,
    'x-pos-installation': installationId,
    ...overrides,
  });
  const deviceGet = (path: string, headers = asDevice()) =>
    api().get(`/pos/device${path}`).set(headers);
  const deviceSync = (operations: object[], headers = asDevice()) =>
    api().post('/pos/device/sync').set(headers).send({ operations });

  const bind = async (token = tenant.adminToken) => {
    const res = await post(
      `/pos/devices/${deviceId}/bind`,
      { installationId },
      token,
    );
    deviceKey = data<{ deviceKey: string }>(res).deviceKey;
    return res;
  };

  const openShift = (shiftId: string, extra: object = {}) => ({
    id: `open-${shiftId}`,
    type: 'shift.open',
    payload: {
      id: shiftId,
      openedAt: '2026-10-12T05:00:00.000Z',
      openingCash: 50,
      ...extra,
    },
  });

  const sale = (shiftId: string) => ({
    id: 'sale-1',
    type: 'sale',
    payload: {
      uuid: randomUUID(),
      number: 'POS1-000001',
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

  const refund = (shiftId: string, issuedAt = '2026-10-12T07:00:00.000Z') => ({
    id: `return-${randomUUID()}`,
    type: 'return',
    payload: {
      uuid: randomUUID(),
      invoiceNumber: 'POS1-000001',
      issuedAt,
      shiftId,
      lines: [{ lineIndex: 0, quantity: 1 }],
      refundMethod: 'cash',
      refundAmount: 2.3,
    },
  });

  const statuses = (res: request.Response) =>
    data<{ results: { status: string; message?: string }[] }>(res).results.map(
      (r) => r.status,
    );

  const addCashier = async (body: object) =>
    data<{ id: string; name: string }>(await post('/pos/cashiers', body));

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
    await dataSource
      .getRepository(Tenant)
      .update(
        { id: tenant.tenantId },
        { country: 'KW', currency: 'KWD', timezone: 'Asia/Kuwait' },
      );

    const units = data<{ id: string }[]>(await get('/catalog/units'));
    productId = data<{ id: string }>(
      await post('/catalog/products', {
        name: 'مياه 330 مل',
        baseUnitId: units[0].id,
        salePrice: 2.3,
      }),
    ).id;
    const warehouses = data<{ id: string; type: string }[]>(
      await get('/inventory/warehouses'),
    );
    const warehouseId = warehouses.find((w) => w.type === 'main')!.id;
    await post('/inventory/adjustments', {
      warehouseId,
      type: 'opening',
      lines: [{ productId, quantity: 50, unitCost: 1 }],
    });
    deviceId = data<{ id: string }>(
      await post('/pos/devices', {
        name: 'كاشير 1',
        code: 'POS1',
        warehouseId,
      }),
    ).id;
    installationId = randomUUID();
    await bind();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('device key', () => {
    it('is handed out once at binding and never listed', async () => {
      expect(deviceKey).toEqual(expect.any(String));
      expect(deviceKey.length).toBeGreaterThanOrEqual(40);

      const listed = JSON.stringify((await get('/pos/devices')).body);
      expect(listed).not.toContain(deviceKey);
      expect(listed).not.toContain('keyHash');
    });

    it('lets the screen pull and push with no user session at all', async () => {
      expect((await deviceGet('/ping')).status).toBe(200);

      const bootstrap = await deviceGet('/bootstrap');
      expect(bootstrap.status).toBe(200);
      expect(data(bootstrap)).toMatchObject({
        full: true,
        products: [{ id: productId }],
        // الشاشة تحفظها لتعمل بعملة الشركة وتوقيتها بلا إنترنت
        tenant: {
          country: 'KW',
          currency: 'KWD',
          currencyDecimals: 3,
          timezone: 'Asia/Kuwait',
        },
        cashiers: [],
        offlinePolicy: { warnAfterHours: 72, blockAfterHours: 168 },
      });

      const shiftId = randomUUID();
      const synced = await deviceSync([openShift(shiftId), sale(shiftId)]);
      expect(synced.status).toBe(200);
      expect(statuses(synced)).toEqual(['ok', 'ok']);

      const lookup = await deviceGet('/invoices/POS1-000001');
      expect(data<{ total: number }>(lookup).total).toBe(4.6);
    });

    it('rejects a wrong key, another screen, and requests without one', async () => {
      expect(
        (await deviceGet('/ping', asDevice({ 'x-pos-key': 'nope' }))).status,
      ).toBe(401);
      expect((await api().get('/pos/device/ping')).status).toBe(401);
      // توكن مستخدم وحده لا يكفي لمسارات الجهاز
      expect((await get('/pos/device/ping')).status).toBe(401);
      expect(
        (
          await deviceGet(
            '/ping',
            asDevice({ 'x-pos-installation': randomUUID() }),
          )
        ).status,
      ).toBe(409);
    });

    it('dies when the manager unbinds or disables the device', async () => {
      const oldKey = deviceKey;

      // ربط جديد لنفس الشاشة يصدر مفتاحاً جديداً ويُبطل السابق
      await bind();
      expect(deviceKey).not.toBe(oldKey);
      expect(
        (await deviceGet('/ping', asDevice({ 'x-pos-key': oldKey }))).status,
      ).toBe(401);
      expect((await deviceGet('/ping')).status).toBe(200);

      await patch(`/pos/devices/${deviceId}`, { isActive: false });
      expect((await deviceGet('/ping')).status).toBe(401);
      await patch(`/pos/devices/${deviceId}`, { isActive: true });
      expect((await deviceGet('/ping')).status).toBe(200);

      // جهاز سُرق: فكّ الربط يوقفه فوراً
      await post(`/pos/devices/${deviceId}/unbind`);
      expect((await deviceGet('/ping')).status).toBe(401);
      expect((await deviceSync([])).status).toBe(401);
    });

    it('answers 402 once the subscription is no longer active', async () => {
      await dataSource
        .getRepository(Subscription)
        .update(
          { tenantId: tenant.tenantId },
          { status: SubscriptionStatus.EXPIRED },
        );

      expect((await deviceGet('/ping')).status).toBe(402);
      expect((await deviceSync([])).status).toBe(402);
    });
  });

  describe('cashiers', () => {
    it('never returns the PIN, and ships a verifier the device can check offline', async () => {
      const created = await post('/pos/cashiers', {
        name: 'سالم',
        pin: '4821',
        canReturn: true,
      });
      expect(created.status).toBe(201);
      const body = JSON.stringify(created.body);
      expect(body).not.toContain('4821');
      expect(body).not.toContain('pinHash');
      expect(JSON.stringify((await get('/pos/cashiers')).body)).not.toContain(
        'pinSalt',
      );

      const [cashier] = data<{
        cashiers: {
          name: string;
          canReturn: boolean;
          pinSalt: string;
          pinHash: string;
          pinIterations: number;
        }[];
      }>(await deviceGet('/bootstrap')).cashiers;
      expect(cashier).toMatchObject({ name: 'سالم', canReturn: true });

      // ما تفعله الشاشة بلا إنترنت: تشتق الرقم المُدخل وتقارنه
      const derive = (pin: string) =>
        pbkdf2Sync(
          pin,
          Buffer.from(cashier.pinSalt, 'base64'),
          cashier.pinIterations,
          32,
          'sha256',
        ).toString('base64');
      expect(derive('4821')).toBe(cashier.pinHash);
      expect(derive('4822')).not.toBe(cashier.pinHash);
    });

    it('validates input and keeps management to managers', async () => {
      expect(
        (await post('/pos/cashiers', { name: 'سالم', pin: '12' })).status,
      ).toBe(400);
      expect(
        (await post('/pos/cashiers', { name: 'سالم', pin: 'abcd' })).status,
      ).toBe(400);

      await addCashier({ name: 'سالم', pin: '1234' });
      expect(
        (await post('/pos/cashiers', { name: 'سالم', pin: '9999' })).status,
      ).toBe(409);

      const seller = tenant.tokenWith(['view_pos', 'use_pos']);
      expect(
        (await post('/pos/cashiers', { name: 'علي', pin: '1234' }, seller))
          .status,
      ).toBe(403);
      expect((await get('/pos/cashiers', seller)).status).toBe(200);
    });

    it('stops shipping a cashier to devices once deactivated or deleted', async () => {
      const salem = await addCashier({ name: 'سالم', pin: '1234' });
      const ali = await addCashier({ name: 'علي', pin: '5678' });
      const names = async () =>
        data<{ cashiers: { name: string }[] }>(
          await deviceGet('/bootstrap'),
        ).cashiers.map((c) => c.name);

      expect(await names()).toEqual(['سالم', 'علي']);

      await patch(`/pos/cashiers/${salem.id}`, { isActive: false });
      expect(await names()).toEqual(['علي']);

      await api()
        .delete(`/pos/cashiers/${ali.id}`)
        .set(auth(tenant.adminToken));
      expect(await names()).toEqual([]);
    });

    it('attributes the shift to its cashier and follows his return permission', async () => {
      const trusted = await addCashier({
        name: 'سالم',
        pin: '1234',
        canReturn: true,
      });
      const junior = await addCashier({ name: 'علي', pin: '5678' });

      const first = randomUUID();
      const opened = await deviceSync([
        openShift(first, { cashierId: trusted.id, cashierName: 'سالم' }),
        sale(first),
        refund(first),
        {
          id: 'close',
          type: 'shift.close',
          payload: {
            id: first,
            closedAt: '2026-10-12T14:00:00.000Z',
            closingCash: 52.3,
          },
        },
      ]);
      expect(statuses(opened)).toEqual(['ok', 'ok', 'ok', 'ok']);
      expect(
        await dataSource.getRepository(PosShift).findOneByOrFail({ id: first }),
      ).toMatchObject({ cashierId: trusted.id, cashierName: 'سالم' });

      // كاشير بلا صلاحية مرتجع: يُرفض مرتجعه ولو كانت الشاشة لمدير
      const second = randomUUID();
      const denied = await deviceSync([
        openShift(second, { cashierId: junior.id }),
        refund(second),
      ]);
      expect(statuses(denied)).toEqual(['ok', 'error']);
    });

    it('still accepts a refund made offline before the permission was revoked', async () => {
      const cashier = await addCashier({
        name: 'سالم',
        pin: '1234',
        canReturn: true,
      });
      const shiftId = randomUUID();
      await deviceSync([
        openShift(shiftId, { cashierId: cashier.id }),
        sale(shiftId),
      ]);

      await patch(`/pos/cashiers/${cashier.id}`, { canReturn: false });

      // سُجّل على الجهاز قبل السحب (النقد خرج فعلاً)، ووصل السيرفر بعده
      const before = new Date(Date.now() - 60_000).toISOString();
      const after = new Date(Date.now() + 60_000).toISOString();
      expect(statuses(await deviceSync([refund(shiftId, before)]))).toEqual([
        'ok',
      ]);
      expect(statuses(await deviceSync([refund(shiftId, after)]))).toEqual([
        'error',
      ]);
    });
  });

  describe('shifts without a cashier', () => {
    it('follow the return permission of whoever bound the screen', async () => {
      // ربطها مدير: المرتجع مسموح بلا جلسة
      const first = randomUUID();
      expect(
        statuses(
          await deviceSync([openShift(first), sale(first), refund(first)]),
        ),
      ).toEqual(['ok', 'ok', 'ok']);

      // أعاد ربطها موظف بلا صلاحية مرتجع
      await bind(tenant.tokenWith(['view_pos', 'use_pos']));
      expect(statuses(await deviceSync([refund(first)]))).toEqual(['error']);

      // جلسة مدير حاضرة مع طلب الجهاز: تُحدّث ما يُعرف عن الشاشة
      const withManager = { ...asDevice(), ...auth(tenant.adminToken) };
      expect(statuses(await deviceSync([refund(first)], withManager))).toEqual([
        'ok',
      ]);
    });
  });
});
