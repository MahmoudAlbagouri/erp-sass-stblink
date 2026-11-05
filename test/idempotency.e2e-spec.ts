import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { IdempotencyRecord } from '../src/common/idempotency/idempotency-record.entity';
import { IdempotencyCleanup } from '../src/common/idempotency/idempotency.module';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * طوابير العمل بلا إنترنت (التطبيق ولوحة التحكم) تعيد إرسال العملية نفسها
 * بمفتاحها: السيرفر ينفّذها مرة واحدة ويعيد الرد الأول.
 */
describe('Idempotency-Key (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  const api = () => request(app.getHttpServer());
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
  const createCustomer = (body: object, key?: string) => {
    const req = api()
      .post('/sales/customers')
      .set('Authorization', `Bearer ${tenant.adminToken}`);
    return (key ? req.set('Idempotency-Key', key) : req).send(body);
  };
  const customers = async () =>
    data<{ data: { id: string; name: string }[] }>(
      await api()
        .get('/sales/customers')
        .set('Authorization', `Bearer ${tenant.adminToken}`),
    ).data;

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
      features: ['sales_module', 'purchasing_module'],
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('runs a repeated operation once and replays its first response', async () => {
    const key = `op-${randomUUID()}`;
    const first = await createCustomer({ name: 'عميل بلا إنترنت' }, key);
    expect(first.status).toBe(201);
    const second = await createCustomer({ name: 'عميل بلا إنترنت' }, key);
    expect(second.status).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(data<{ id: string }>(second).id).toBe(
      data<{ id: string }>(first).id,
    );
    expect(await customers()).toHaveLength(1);
  });

  it('frees the key when the operation fails, so a fixed retry runs', async () => {
    const key = `op-${randomUUID()}`;
    const invalid = await createCustomer({ name: '' }, key);
    expect(invalid.status).toBe(400);
    const fixed = await createCustomer({ name: 'بعد التصحيح' }, key);
    expect(fixed.status).toBe(201);
    expect(await customers()).toHaveLength(1);
  });

  it('refuses the same key for a different request', async () => {
    const key = `op-${randomUUID()}`;
    await createCustomer({ name: 'أول' }, key);
    const other = await api()
      .post('/purchasing/suppliers')
      .set('Authorization', `Bearer ${tenant.adminToken}`)
      .set('Idempotency-Key', key)
      .send({ name: 'مورد' });
    expect(other.status).toBe(422);
  });

  it('leaves requests without a key untouched, and rejects a malformed key', async () => {
    await createCustomer({ name: 'أ' });
    await createCustomer({ name: 'أ' });
    expect(await customers()).toHaveLength(2);
    expect((await createCustomer({ name: 'ب' }, 'bad key!')).status).toBe(400);
  });

  it('forgets old keys', async () => {
    const key = `op-${randomUUID()}`;
    await createCustomer({ name: 'قديم' }, key);
    const removed = await app
      .get(IdempotencyCleanup)
      .run(new Date(Date.now() + 31 * 86_400_000));
    expect(removed).toBe(1);
    expect(await dataSource.getRepository(IdempotencyRecord).count()).toBe(0);
  });
});
