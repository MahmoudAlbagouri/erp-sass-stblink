import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/** صورة PNG بنقطة واحدة: أصغر شعار صالح */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** شعار الشركة: مديرها يرفعه ويغيّره ويحذفه، وكل موظفيها يقرؤونه للطباعة */
describe('Tenant branding (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;
  let other: TenantFixture;

  const api = () => request(app.getHttpServer());
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
  const branding = (token: string) =>
    api().get('/tenants/me/branding').set('Authorization', `Bearer ${token}`);
  const putLogo = (token: string, logo: unknown) =>
    api()
      .patch('/tenants/me/logo')
      .set('Authorization', `Bearer ${token}`)
      .send({ logo });

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
    tenant = await createTenantFixture(dataSource);
    other = await createTenantFixture(dataSource);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lets the company manager upload, replace and remove the logo', async () => {
    expect(data(await branding(tenant.adminToken))).toMatchObject({
      logo: null,
    });

    const saved = await putLogo(tenant.adminToken, PNG);
    expect(saved.status).toBe(200);
    expect(data(saved)).toMatchObject({ logo: PNG });

    // أي موظف في الشركة يقرؤه (للطباعة)، وشركة أخرى لا ترى شعارها فيه
    expect(data(await branding(tenant.tokenWith([])))).toMatchObject({
      logo: PNG,
    });
    expect(data(await branding(other.adminToken))).toMatchObject({
      logo: null,
    });

    const removed = await api()
      .delete('/tenants/me/logo')
      .set('Authorization', `Bearer ${tenant.adminToken}`);
    expect(removed.status).toBe(200);
    expect(data(removed)).toMatchObject({ logo: null });
  });

  it('allows only the manager to change it, and only images', async () => {
    expect((await putLogo(tenant.tokenWith(['view_sales']), PNG)).status).toBe(
      403,
    );
    expect(
      (
        await api()
          .delete('/tenants/me/logo')
          .set('Authorization', `Bearer ${tenant.tokenWith([])}`)
      ).status,
    ).toBe(403);

    for (const bad of [
      'https://example.com/logo.png',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'data:text/html;base64,PGgxPmhpPC9oMT4=',
      'data:image/png;base64,<script>',
    ]) {
      expect((await putLogo(tenant.adminToken, bad)).status).toBe(400);
    }
    expect(data(await branding(tenant.adminToken))).toMatchObject({
      logo: null,
    });
  });
});
