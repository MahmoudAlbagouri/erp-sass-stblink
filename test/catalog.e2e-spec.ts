import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * موديول الأصناف عبر الـ HTTP كاملاً: التوكن، الخطة، الصلاحيات، حد الخطة،
 * التحقق من المدخلات — كما يستخدمه الفرونت.
 */
describe('Catalog API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  // كل الردود تُغلَّف بـ TransformInterceptor: { success, data, ... }
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

  const firstUnitId = async (token: string): Promise<string> => {
    const res = await api().get('/catalog/units').set(auth(token));
    return data<{ id: string }[]>(res)[0].id;
  };

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
      features: ['products_module'],
      quotas: { max_products: 2 },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates a product and finds it by barcode', async () => {
    const baseUnitId = await firstUnitId(tenant.adminToken);

    const created = await api()
      .post('/catalog/products')
      .set(auth(tenant.adminToken))
      .send({
        name: 'مياه 330 مل',
        baseUnitId,
        salePrice: 2,
        barcodes: [{ barcode: '6281000000017' }],
      });

    expect(created.status).toBe(201);
    expect(data(created)).toMatchObject({ sku: 'P-000001', salePrice: 2 });

    const lookup = await api()
      .get('/catalog/products/barcode/6281000000017')
      .set(auth(tenant.adminToken));

    expect(lookup.status).toBe(200);
    expect(data(lookup)).toMatchObject({ factor: 1, unitPrice: 2 });
  });

  it('rejects invalid input with 400', async () => {
    const baseUnitId = await firstUnitId(tenant.adminToken);
    const send = (body: object) =>
      api().post('/catalog/products').set(auth(tenant.adminToken)).send(body);

    expect((await send({ baseUnitId, salePrice: 2 })).status).toBe(400); // بلا اسم
    expect((await send({ name: 'x', baseUnitId, salePrice: -1 })).status).toBe(
      400,
    );
    expect(
      (await send({ name: 'x', baseUnitId: 'not-a-uuid', salePrice: 1 }))
        .status,
    ).toBe(400);
    expect(
      (
        await send({
          name: 'x',
          baseUnitId,
          salePrice: 1,
          barcodes: [{ barcode: 'has space' }],
        })
      ).status,
    ).toBe(400);
    // حقل غير معروف (مثل tenantId) يُرفض ولا يُتجاهل بصمت
    expect(
      (await send({ name: 'x', baseUnitId, salePrice: 1, tenantId: 'other' }))
        .status,
    ).toBe(400);
  });

  it('enforces the plan quota (max_products)', async () => {
    const baseUnitId = await firstUnitId(tenant.adminToken);
    const create = (name: string) =>
      api()
        .post('/catalog/products')
        .set(auth(tenant.adminToken))
        .send({ name, baseUnitId, salePrice: 1 });

    expect((await create('الأول')).status).toBe(201);
    expect((await create('الثاني')).status).toBe(201);

    const third = await create('الثالث');
    expect(third.status).toBe(403);
  });

  it('blocks the whole module when the plan lacks the feature', async () => {
    const noFeature = await createTenantFixture(dataSource, { features: [] });

    const res = await api()
      .get('/catalog/products')
      .set(auth(noFeature.adminToken));

    expect(res.status).toBe(403);
  });

  it('checks permissions per action', async () => {
    const viewer = tenant.tokenWith(['view_products']);
    const baseUnitId = await firstUnitId(viewer);

    const list = await api().get('/catalog/products').set(auth(viewer));
    const create = await api()
      .post('/catalog/products')
      .set(auth(viewer))
      .send({ name: 'x', baseUnitId, salePrice: 1 });
    const addUnit = await api()
      .post('/catalog/units')
      .set(auth(viewer))
      .send({ name: 'طرد' });

    expect(list.status).toBe(200);
    expect(create.status).toBe(403);
    expect(addUnit.status).toBe(403);
  });

  it('keeps tenants isolated over HTTP', async () => {
    const other = await createTenantFixture(dataSource, {
      features: ['products_module'],
    });
    const baseUnitId = await firstUnitId(tenant.adminToken);
    const created = await api()
      .post('/catalog/products')
      .set(auth(tenant.adminToken))
      .send({ name: 'خاص بالشركة أ', baseUnitId, salePrice: 5 });
    const productId = data<{ id: string }>(created).id;

    const read = await api()
      .get(`/catalog/products/${productId}`)
      .set(auth(other.adminToken));
    const list = await api()
      .get('/catalog/products')
      .set(auth(other.adminToken));
    const remove = await api()
      .delete(`/catalog/products/${productId}`)
      .set(auth(other.adminToken));

    expect(read.status).toBe(404);
    expect(data<{ total: number }>(list).total).toBe(0);
    expect(remove.status).toBe(404);
  });
});
