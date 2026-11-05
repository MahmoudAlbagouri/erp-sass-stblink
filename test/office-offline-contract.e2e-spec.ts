import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * عقد طابور المكتب في تطبيق الكاشير (Flutter): يوم مكتب كامل سُجّل بلا إنترنت
 * (`office_contract_test.dart` في stb_pos يكتبه) يُرفع هنا بترتيبه، كما يرفعه
 * التطبيق: كل عملية بمفتاحها، والمعرّف المؤقت لما أُنشئ يُستبدل بالحقيقي.
 */
const DUMP = resolve(
  __dirname,
  '../../../mobile-developer/stb_pos/build/office_contract_ops.json',
);
const PRODUCT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MAIN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BRANCH = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

interface QueuedOp {
  id: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body: unknown;
  tempId: string | null;
}

(existsSync(DUMP) ? describe : describe.skip)(
  'Office offline queue contract (e2e)',
  () => {
    let app: INestApplication<App>;
    let dataSource: DataSource;
    let tenant: TenantFixture;

    const api = () => request(app.getHttpServer());
    const bearer = () => ({ Authorization: `Bearer ${tenant.adminToken}` });
    const data = <T>(res: request.Response): T =>
      (res.body as { data: T }).data;

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
          'purchasing_module',
        ],
      });
    });

    afterAll(async () => {
      await app?.close();
    });

    it('accepts the whole day in order, resolving offline ids', async () => {
      const units = data<{ id: string }[]>(
        await api().get('/catalog/units').set(bearer()),
      );
      const productId = data<{ id: string }>(
        await api()
          .post('/catalog/products')
          .set(bearer())
          .send({ name: 'ماء', baseUnitId: units[0].id, salePrice: 2.5 }),
      ).id;
      const mainId = data<{ id: string; type: string }[]>(
        await api().get('/inventory/warehouses').set(bearer()),
      ).find((w) => w.type === 'main')!.id;
      const branchId = data<{ id: string }>(
        await api()
          .post('/inventory/warehouses')
          .set(bearer())
          .send({ name: 'مخزن الفرع' }),
      ).id;
      await api()
        .post('/inventory/adjustments')
        .set(bearer())
        .send({
          warehouseId: mainId,
          type: 'opening',
          lines: [{ productId, quantity: 50, unitCost: 1 }],
        });

      const ops = JSON.parse(
        readFileSync(DUMP, 'utf8')
          .split(PRODUCT)
          .join(productId)
          .split(MAIN)
          .join(mainId)
          .split(BRANCH)
          .join(branchId),
      ) as QueuedOp[];
      expect(ops.length).toBeGreaterThanOrEqual(9);

      // كما يرفع التطبيق: بالترتيب، وبمفتاح كل عملية، والمؤقت ← الحقيقي
      const ids = new Map<string, string>();
      const swap = (text: string) =>
        text.replace(/tmp-[0-9a-f-]{36}/g, (temp) => ids.get(temp) ?? temp);
      const send = (op: QueuedOp) =>
        api()
          [op.method.toLowerCase() as 'post' | 'patch' | 'delete'](
            swap(op.path),
          )
          .set(bearer())
          .set('Idempotency-Key', op.id)
          .send(JSON.parse(swap(JSON.stringify(op.body ?? {}))) as object);

      for (const op of ops) {
        const res = await send(op);
        // رسالة السيرفر نفسها في الفشل: أي حقل لا يقبله يظهر هنا
        if (res.status >= 300) {
          throw new Error(
            `${op.method} ${op.path}: ${JSON.stringify(res.body)}`,
          );
        }
        if (op.tempId) ids.set(op.tempId, data<{ id: string }>(res).id);
      }

      // رفع الطابور مرة ثانية (انقطع الرد): لا يتكرر شيء
      for (const op of ops) {
        const again = await send(op);
        expect(again.headers['idempotent-replayed']).toBe('true');
      }

      const invoices = data<{
        data: { number: string | null; status: string; total: number }[];
      }>(await api().get('/sales/invoices').set(bearer()));
      expect(invoices.data).toHaveLength(1);
      expect(invoices.data[0].status).toBe('issued');
      expect(invoices.data[0].number).toEqual(expect.any(String));

      const customers = data<{ data: { name: string }[] }>(
        await api().get('/sales/customers').set(bearer()),
      );
      expect(customers.data.map((c) => c.name)).toContain('عميل بلا إنترنت');

      const transfers = data<{ data: { status: string }[] }>(
        await api().get('/inventory/transfers').set(bearer()),
      );
      expect(transfers.data[0].status).toBe('in_transit');
    });
  },
);
