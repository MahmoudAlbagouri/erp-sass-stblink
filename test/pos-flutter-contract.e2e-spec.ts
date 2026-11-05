import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * عقد تطبيق الكاشير (Flutter): العمليات كما يولّدها التطبيق نفسه في وردية
 * كاملة بلا إنترنت (`wire_contract_test.dart` في stb_pos يكتبها) تُرفع هنا
 * كما هي، والسيرفر يقبلها كلها ويحفظ الفواتير بأرقامها ومبالغها.
 */
const DUMP = resolve(
  __dirname,
  '../../../mobile-developer/stb_pos/build/pos_contract_ops.json',
);
const PRODUCT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CASHIER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
/** صنف "رسوم التوصيل" وطاولة المطبخ: يحل محلهما ما في هذه القاعدة */
const FEE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const TABLE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

(existsSync(DUMP) ? describe : describe.skip)(
  'Flutter POS wire contract (e2e)',
  () => {
    let app: INestApplication<App>;
    let dataSource: DataSource;
    let tenant: TenantFixture;

    const api = () => request(app.getHttpServer());
    const auth = { Authorization: '' };
    const data = <T>(res: request.Response): T =>
      (res.body as { data: T }).data;
    const get = (path: string) => api().get(path).set(auth);
    const post = (path: string, body: object = {}) =>
      api().post(path).set(auth).send(body);

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
      await truncateAllTables(dataSource);
      tenant = await createTenantFixture(dataSource, {
        features: [
          'products_module',
          'inventory_module',
          'sales_module',
          'pos_module',
          'delivery_module',
          'restaurant_module',
        ],
      });
      auth.Authorization = `Bearer ${tenant.adminToken}`;
    });

    afterAll(async () => {
      await app?.close();
    });

    it('accepts every operation the app queued, in order', async () => {
      const units = data<{ id: string }[]>(await get('/catalog/units'));
      const rates = data<{ id: string; rate: number }[]>(
        await get('/catalog/tax-rates'),
      );
      const vat = rates.find((rate) => Number(rate.rate) === 15);
      const productId = data<{ id: string }>(
        await post('/catalog/products', {
          name: 'ماء',
          baseUnitId: units[0].id,
          salePrice: 2.5,
          ...(vat ? { taxRateId: vat.id } : {}),
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
      const cashierId = data<{ id: string }>(
        await post('/pos/cashiers', {
          name: 'سارة',
          pin: '1234',
          canReturn: true,
          isSupervisor: true,
        }),
      ).id;
      const installationId = randomUUID();
      const deviceKey = data<{ deviceKey: string }>(
        await post(`/pos/devices/${deviceId}/bind`, { installationId }),
      ).deviceKey;

      const headers = {
        'x-pos-device': deviceId,
        'x-pos-key': deviceKey,
        'x-pos-installation': installationId,
      };
      // صنف رسوم التوصيل يُنشأ مع أول تنزيل للجهاز
      const feeProductId = data<{ delivery: { feeProductId: string } }>(
        await api().get('/pos/device/bootstrap').set(headers),
      ).delivery.feeProductId;
      const tableId = data<{ id: string }>(
        await post('/pos/restaurant/tables', { name: 'T1', seats: 4 }),
      ).id;

      const dump = JSON.parse(
        readFileSync(DUMP, 'utf8')
          .split(PRODUCT)
          .join(productId)
          .split(CASHIER)
          .join(cashierId)
          .split(FEE)
          .join(feeProductId)
          .split(TABLE)
          .join(tableId),
      ) as {
        operations: { id: string; type: string; payload: object }[];
        expect: Record<
          'cash' | 'credit' | 'delivery',
          { number: string; total: string }
        >;
        quote: string;
      };
      const synced = await api()
        .post('/pos/device/sync')
        .set(headers)
        .send({ operations: dump.operations });
      expect(synced.status).toBe(200);
      const results = data<{
        results: { id: string; status: string; message?: string }[];
      }>(synced).results;
      // إغلاق الطاولة يسلّم الجاهز فقط: بونات لم تجهز بعد = "duplicate" (مقبول)
      expect(
        results.filter(
          (r) =>
            r.status !== 'ok' &&
            !(r.status === 'duplicate' && r.id.startsWith('kitchen-close-')),
        ),
      ).toEqual([]);
      expect(results).toHaveLength(dump.operations.length);

      for (const sale of Object.values(dump.expect)) {
        const invoice = await api()
          .get(`/pos/device/invoices/${sale.number}`)
          .set(headers);
        expect(invoice.status).toBe(200);
        expect(Number(data<{ total: number }>(invoice).total)).toBe(
          Number(sale.total),
        );
      }

      // عرض السعر وصل وتحوّل لفاتورة التوصيل، ولها أوردر توصيل
      const quote = await api()
        .get(`/pos/device/quotes/${dump.quote}`)
        .set(headers);
      expect(quote.status).toBe(200);
      expect(
        data<{ status: string; convertedInvoiceNumber: string }>(quote),
      ).toMatchObject({
        status: 'converted',
        convertedInvoiceNumber: dump.expect.delivery.number,
      });
      const orders = await get('/delivery/orders');
      expect(orders.status).toBe(200);
      expect(JSON.stringify(orders.body)).toContain('حي النخيل، شارع 5');

      // الرفع مرة ثانية (انقطاع بعد الإرسال) لا يكرر شيئاً
      const again = await api()
        .post('/pos/device/sync')
        .set(headers)
        .send({ operations: dump.operations });
      const repeated = data<{ results: { status: string }[] }>(again).results;
      expect(
        repeated.every((r) => r.status === 'duplicate' || r.status === 'ok'),
      ).toBe(true);
    });
  },
);
