import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bodyParser from 'body-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AttendanceLog } from '../src/modules/attendance/entities/attendance-log.entity';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * أجهزة البصمة غير ZKTeco وملفات البصمات عبر HTTP: Hikvision بمفتاح في
 * الرابط (JSON أو multipart)، أي جهاز بمفتاح في الترويسة، واستيراد ملف.
 */
describe('Attendance devices (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

  interface CreatedDevice {
    id: string;
    pushKey?: string;
  }
  const addDevice = async (protocol: string, serialNumber: string) =>
    data<CreatedDevice>(
      await api()
        .post('/attendance/devices')
        .set(auth(tenant.adminToken))
        .send({ serialNumber, protocol })
        .expect(201),
    );

  const hikEvent = (employeeNo: string, dateTime: string) => ({
    dateTime,
    eventType: 'AccessControllerEvent',
    AccessControllerEvent: {
      majorEventType: 5,
      subEventType: 75,
      employeeNoString: employeeNo,
    },
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // كما في main.ts: محلل JSON لمسار واحد يُلغي محلل Nest العام، فيُضاف صراحة
    app.use('/iclock', bodyParser.text({ type: () => true, limit: '10mb' }));
    app.use('/attendance-push', bodyParser.json({ limit: '2mb' }));
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
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
      features: ['attendance_module', 'biometric_integration'],
      quotas: { max_biometric_devices: 5 },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('accepts Hikvision events only with the device key, as JSON or multipart', async () => {
    const device = await addDevice('hikvision', 'HIK-E2E');
    const url = `/attendance-push/hikvision/${device.id}/${device.pushKey}`;

    await api().get(url).expect(200);
    await api()
      .post(`/attendance-push/hikvision/${device.id}/wrong-key`)
      .send(hikEvent('1001', '2026-01-12T08:00:00+03:00'))
      .expect(401);

    await api()
      .post(url)
      .send(hikEvent('1001', '2026-01-12T08:00:00+03:00'))
      .expect(200);
    await api()
      .post(url)
      .field(
        'event_log',
        JSON.stringify(hikEvent('1001', '2026-01-12T17:00:00+03:00')),
      )
      .attach('Picture', Buffer.from('jpeg'), 'face.jpg')
      .expect(200);

    const logs = await dataSource.getRepository(AttendanceLog).find({
      where: { tenantId: tenant.tenantId },
      order: { punchTime: 'ASC' },
    });
    expect(logs.map((l) => l.punchTime.toISOString())).toEqual([
      '2026-01-12T05:00:00.000Z',
      '2026-01-12T14:00:00.000Z',
    ]);
  });

  it('accepts punches from any device with its key in the headers', async () => {
    const device = await addDevice('api', 'API-E2E');
    const body = { punches: [{ pin: '7', time: '2026-01-12T08:00:00+03:00' }] };

    await api().post('/attendance-push/api').send(body).expect(401);
    const res = await api()
      .post('/attendance-push/api')
      .set('X-Device-Id', device.id)
      .set('X-Device-Key', device.pushKey!)
      .send(body)
      .expect(200);
    expect(data(res)).toEqual({
      received: 1,
      saved: 1,
      duplicates: 0,
      unlinked: 1,
    });

    // البصمة لرقم غير مربوط تظهر للربط
    const pins = await api()
      .get('/attendance/unlinked-pins')
      .set(auth(tenant.adminToken))
      .expect(200);
    expect(data<{ pin: string }[]>(pins)).toMatchObject([{ pin: '7' }]);
  });

  it('receives ZKTeco punches over ADMS, even without a Content-Type', async () => {
    await addDevice('zk_adms', 'ZK-E2E');
    await api().get('/iclock/cdata?SN=OTHER-SN').expect(403);

    const init = await api()
      .get('/iclock/cdata?SN=ZK-E2E&options=all&pushver=2.4.1')
      .expect(200);
    expect(init.text).toContain('GET OPTION FROM: ZK-E2E');

    // بعض الأجهزة لا ترسل Content-Type: يُقرأ الجسم ولا يُرد "OK: 0" على بصمة
    const upload = await api()
      .post('/iclock/cdata?SN=ZK-E2E&table=ATTLOG&Stamp=1')
      .send('1001\t2026-01-12 08:00:00\t0\t1\t0\t0\n')
      .unset('Content-Type')
      .expect(200);
    expect(upload.text).toBe('OK: 1');

    await api().get('/iclock/getrequest?SN=ZK-E2E').expect(200, 'OK');
    const logs = await dataSource
      .getRepository(AttendanceLog)
      .findBy({ deviceSn: 'ZK-E2E' });
    expect(logs.map((l) => l.deviceUserId)).toEqual(['1001']);
  });

  it('imports a punches file after previewing its columns', async () => {
    const csv = 'ID,Time\n7,12/01/2026 08:00\n7,12/01/2026 16:30\n';

    const preview = await api()
      .post('/attendance/import/preview')
      .set(auth(tenant.adminToken))
      .attach('file', Buffer.from(csv), 'punches.csv')
      .expect(201);
    expect(data(preview)).toMatchObject({
      guess: { pinColumn: 0, dateTimeColumn: 1 },
    });

    const imported = await api()
      .post('/attendance/import')
      .set(auth(tenant.adminToken))
      .field('pinColumn', '0')
      .field('dateTimeColumn', '1')
      .attach('file', Buffer.from(csv), 'punches.csv')
      .expect(201);
    expect(data(imported)).toMatchObject({ imported: 2, unlinked: 2 });

    // بلا صلاحية الاستيراد
    await api()
      .post('/attendance/import')
      .set(auth(tenant.tokenWith(['view_attendance_logs'])))
      .field('pinColumn', '0')
      .attach('file', Buffer.from(csv), 'punches.csv')
      .expect(403);
  });

  it('manages the company rest days and holidays', async () => {
    const settings = await api()
      .get('/attendance/settings')
      .set(auth(tenant.adminToken))
      .expect(200);
    expect(data(settings)).toMatchObject({
      weeklyOffDays: [5],
      deductAbsence: false,
    });

    await api()
      .patch('/attendance/settings')
      .set(auth(tenant.adminToken))
      .send({ weeklyOffDays: [0, 1, 2, 3, 4, 5, 6] })
      .expect(400);
    await api()
      .patch('/attendance/settings')
      .set(auth(tenant.adminToken))
      .send({ weeklyOffDays: [5, 6], deductAbsence: true })
      .expect(200);

    const holiday = await api()
      .post('/attendance/holidays')
      .set(auth(tenant.adminToken))
      .send({ name: 'عيد', startDate: '2026-03-20', endDate: '2026-03-22' })
      .expect(201);
    const list = await api()
      .get('/attendance/holidays?year=2026')
      .set(auth(tenant.adminToken))
      .expect(200);
    expect(data<unknown[]>(list)).toHaveLength(1);

    await api()
      .delete(`/attendance/holidays/${data<{ id: string }>(holiday).id}`)
      .set(auth(tenant.tokenWith(['view_attendance_summary'])))
      .expect(403);
  });
});
