import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bodyParser from 'body-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import type { JwtPayload } from '../src/common/types/auth.types';
import { Plan } from '../src/modules/plans/entities/plan.entity';
import { Tenant } from '../src/modules/tenants/entities/tenant.entity';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * تعدد الدول عبر HTTP كما يراه العميل والجهاز: التسجيل بدولة يحدد العملة
 * والهاتف والتوقيت، وجهاز البصمة يتبع توقيت شركته.
 */
describe('Localization (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  const api = () => request(app.getHttpServer());
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

  const register = (overrides: Record<string, unknown> = {}) =>
    api()
      .post('/auth/register')
      .send({
        companyName: 'شركة النيل',
        country: 'EG',
        phone: '010 1234 5678',
        username: 'admin_nile',
        email: 'admin@nile.test',
        password: 'secret123',
        ...overrides,
      });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // كما في main.ts: أجهزة البصمة ترسل نصاً خاماً
    app.use('/iclock', bodyParser.text({ type: '*/*', limit: '10mb' }));
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
    // التسجيل يبدأ بالخطة المجانية
    await dataSource
      .getRepository(Plan)
      .save({ name: 'FREE', nameAr: 'مجانية', features: [], quotas: {} });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('registration', () => {
    it('derives currency, timezone and phone format from the country', async () => {
      const res = await register();
      expect(res.status).toBe(201);

      const tenant = await dataSource
        .getRepository(Tenant)
        .findOneByOrFail({ companyName: 'شركة النيل' });
      expect(tenant).toMatchObject({
        country: 'EG',
        currency: 'EGP',
        timezone: 'Africa/Cairo',
        phone: '+201012345678',
      });

      // الواجهة تقرأ العملة والتوقيت من التوكن مباشرة
      const { accessToken } = data<{ accessToken: string }>(res);
      expect(new JwtService().decode<JwtPayload>(accessToken)).toMatchObject({
        country: 'EG',
        currency: 'EGP',
        timezone: 'Africa/Cairo',
      });
    });

    it('requires a supported country', async () => {
      expect((await register({ country: undefined })).status).toBe(400);
      expect((await register({ country: 'XX' })).status).toBe(400);
    });

    it('rejects a phone number that does not belong to the country', async () => {
      const res = await register({ phone: '+966501234567' });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('رقم الهاتف غير صالح');
      expect(await dataSource.getRepository(Tenant).count()).toBe(0);
    });

    it('refuses a currency chosen by the client', async () => {
      expect((await register({ currency: 'USD' })).status).toBe(400);
    });
  });

  describe('biometric device protocol', () => {
    let tenant: TenantFixture;
    const SN = 'E2E0001';
    const cdata = (query: Record<string, string>) =>
      api().get('/iclock/cdata').query(query);

    beforeEach(async () => {
      tenant = await createTenantFixture(dataSource, {
        features: ['attendance_module', 'biometric_integration'],
        quotas: { max_biometric_devices: 5 },
      });
      await dataSource
        .getRepository(Tenant)
        .update({ id: tenant.tenantId }, { timezone: 'Asia/Kuwait' });

      const created = await api()
        .post('/attendance/devices')
        .set({ Authorization: `Bearer ${tenant.adminToken}` })
        .send({ serialNumber: SN, alias: 'المدخل' });
      expect(created.status).toBe(201);
    });

    it('configures the device, stores its punches and serves them back', async () => {
      const init = await cdata({ SN, options: 'all', pushver: '2.4.1' });
      expect(init.status).toBe(200);
      expect(init.text).toContain(`GET OPTION FROM: ${SN}`);
      expect(init.text).toContain('TimeZone=3');

      const upload = await api()
        .post('/iclock/cdata')
        .query({ SN, table: 'ATTLOG', Stamp: '7' })
        .set('Content-Type', 'text/plain')
        .send('501\t2026-01-12 08:15:00\t0\t1\t0\t0\n');
      expect(upload.status).toBe(200);
      expect(upload.text).toBe('OK: 1');

      const logs = await api()
        .get('/attendance/logs')
        .query({ from: '2026-01-12', to: '2026-01-12' })
        .set({ Authorization: `Bearer ${tenant.adminToken}` });
      expect(logs.status).toBe(200);
      expect(
        data<{ data: { punchTime: string; deviceUserId: string }[] }>(logs)
          .data,
      ).toEqual([
        expect.objectContaining({
          deviceUserId: '501',
          // 08:15 بتوقيت الكويت
          punchTime: '2026-01-12T05:15:00.000Z',
        }),
      ]);

      const devices = await api()
        .get('/attendance/devices')
        .set({ Authorization: `Bearer ${tenant.adminToken}` });
      expect(data<{ status: string }[]>(devices)[0].status).toBe('online');
    });

    it('turns away devices that are not registered', async () => {
      expect((await cdata({ SN: 'NOPE' })).status).toBe(403);

      const upload = await api()
        .post('/iclock/cdata')
        .query({ SN: 'NOPE', table: 'ATTLOG' })
        .set('Content-Type', 'text/plain')
        .send('501\t2026-01-12 08:15:00\t0\t1\n');
      expect(upload.status).toBe(403);
    });

    it('answers the heartbeat and other tables without storing anything', async () => {
      const heartbeat = await api().get('/iclock/getrequest').query({ SN });
      expect(heartbeat.text).toBe('OK');

      // سجل العمليات يُقَرّ باستلام أسطره (يُحفظ منه شيء فقط مع نسخ البصمات)
      const operlog = await api()
        .post('/iclock/cdata')
        .query({ SN, table: 'OPERLOG' })
        .set('Content-Type', 'text/plain')
        .send('OPLOG 4\t0\t2026-01-12 08:00:00\t0\t0\t0\t0\n');
      expect(operlog.text).toBe('OK: 1');

      const photo = await api()
        .post('/iclock/cdata')
        .query({ SN, table: 'ATTPHOTO' })
        .set('Content-Type', 'text/plain')
        .send('PIN=1\n');
      expect(photo.text).toBe('OK: 0');
    });
  });
});
