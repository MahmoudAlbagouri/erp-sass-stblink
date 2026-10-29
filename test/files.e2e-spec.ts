import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import type { FileView } from '../src/modules/files/entities/stored-file.entity';
import { FilesCleanupService } from '../src/modules/files/files-cleanup.service';
import { FileUrlSigner } from '../src/modules/files/file-url.signer';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

// صورة PNG حقيقية (1×1) وملف PDF صغير، وملف HTML يدّعي أنه صورة
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
const FAKE_PNG = Buffer.from('<html><script>alert(1)</script></html>');

/**
 * الملفات المرفوعة: لا تُفتح إلا برابط موقَّع مؤقت يصدر في رد من له حق رؤية
 * السجل، ولا تُربط إلا بسجلات شركتها.
 */
describe('Files (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;
  const filesDir = mkdtempSync(join(tmpdir(), 'erp-files-'));

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
  /** مسار الرابط الموقَّع داخل خادم الاختبار */
  const pathOf = (url: string) => {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  };

  const upload = (
    token: string,
    files: { buffer: Buffer; name: string; type: string }[],
    category = 'employee',
  ) => {
    let req = api().post(`/files/${category}`).set(auth(token));
    for (const file of files) {
      req = req.attach('files', file.buffer, {
        filename: file.name,
        contentType: file.type,
      });
    }
    return req;
  };
  const uploadPng = async (token = tenant.adminToken, name = 'هوية.png') =>
    data<FileView[]>(
      await upload(token, [{ buffer: PNG, name, type: 'image/png' }]).expect(
        201,
      ),
    )[0];

  beforeAll(async () => {
    process.env.FILES_DIR = filesDir;
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
      features: ['employees_module', 'contracts_module'],
    });
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.FILES_DIR;
    rmSync(filesDir, { recursive: true, force: true });
  });

  it('uploads to the company and serves a file only through its signed link', async () => {
    const res = await upload(tenant.adminToken, [
      { buffer: PNG, name: 'هوية الموظف.png', type: 'image/png' },
      { buffer: PDF, name: 'عقد.pdf', type: 'application/pdf' },
    ]).expect(201);
    const [image, pdf] = data<FileView[]>(res);

    expect(image).toMatchObject({
      name: 'هوية الموظف.png',
      mimeType: 'image/png',
      size: PNG.length,
    });
    expect(image.url).toContain(`/files/${image.id}/`);
    expect(pdf.mimeType).toBe('application/pdf');
    // مساره على القرص وشركته لا يخرجان في الرد
    expect(Object.keys(image).sort()).toEqual(
      ['id', 'mimeType', 'name', 'size', 'url'].sort(),
    );
    expect(
      existsSync(
        join(filesDir, tenant.tenantId, 'employee', `${image.id}.png`),
      ),
    ).toBe(true);

    const served = await api().get(pathOf(image.url)).expect(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['content-disposition']).toBe(
      `inline; filename*=UTF-8''${encodeURIComponent('هوية الموظف.png')}`,
    );
    expect(Buffer.compare(served.body as Buffer, PNG)).toBe(0);
    const downloaded = await api()
      .get(`${pathOf(image.url)}&download=1`)
      .expect(200);
    expect(downloaded.headers['content-disposition']).toMatch(/^attachment;/);

    // بلا توقيع، أو بتوقيع معدَّل، أو بتوقيع ملف آخر: مرفوض
    const url = new URL(image.url);
    const sig = url.searchParams.get('sig')!;
    await api().get(url.pathname).expect(403);
    url.searchParams.set('sig', `${sig.slice(0, -2)}xx`);
    await api()
      .get(url.pathname + url.search)
      .expect(403);
    const other = new URL(pdf.url);
    other.searchParams.set('sig', sig);
    other.searchParams.set('exp', new URL(image.url).searchParams.get('exp')!);
    await api()
      .get(other.pathname + other.search)
      .expect(403);

    // رابط انتهت صلاحيته
    const expired = app
      .get(FileUrlSigner)
      .url(
        { id: image.id, originalName: image.name },
        'http://x',
        Date.now() - 3 * 60 * 60 * 1000,
      );
    await api().get(pathOf(expired)).expect(403);
  });

  it('checks the content, not the claimed type, and requires a company user', async () => {
    const fake = await upload(tenant.adminToken, [
      { buffer: FAKE_PNG, name: 'photo.png', type: 'image/png' },
    ]).expect(400);
    expect((fake.body as { message: string }).message).toContain('photo.png');
    // صورة الصنف صورة فقط
    await upload(
      tenant.adminToken,
      [{ buffer: PDF, name: 'x.pdf', type: 'application/pdf' }],
      'product',
    ).expect(400);
    await upload(
      tenant.adminToken,
      [{ buffer: PNG, name: 'x.png', type: 'image/png' }],
      'secrets',
    ).expect(400);
    await api()
      .post('/files/employee')
      .attach('files', PNG, { filename: 'x.png', contentType: 'image/png' })
      .expect(401);
    expect(await dataSource.query(`SELECT id FROM files`)).toEqual([]);
  });

  it('closes the old public uploads route', async () => {
    await api().get('/uploads/employee/image/anything.jpg').expect(404);
  });

  it('attaches files only within their company and returns them signed', async () => {
    const card = await uploadPng();
    const other = await createTenantFixture(dataSource, {
      features: ['employees_module'],
    });

    // شركة أخرى لا تستطيع ربط ملف هذه الشركة بموظفها (ثم فتحه)
    await api()
      .post('/employees')
      .set(auth(other.adminToken))
      .send({
        fullName: 'دخيل',
        nationalityType: 'saudi',
        nationalIdCardFileId: card.id,
      })
      .expect(400);

    const created = data<{ id: string; nationalIdCard: FileView }>(
      await api()
        .post('/employees')
        .set(auth(tenant.adminToken))
        .send({
          fullName: 'سارة',
          nationalityType: 'saudi',
          nationalIdCardFileId: card.id,
        })
        .expect(201),
    );
    expect(created.nationalIdCard).toMatchObject({
      id: card.id,
      name: 'هوية.png',
      mimeType: 'image/png',
    });

    const employee = data<{ nationalIdCard: FileView }>(
      await api()
        .get(`/employees/${created.id}`)
        .set(auth(tenant.adminToken))
        .expect(200),
    );
    expect(employee.nationalIdCard.id).toBe(card.id);
    expect(employee.nationalIdCard).not.toHaveProperty('storageKey');
    await api().get(pathOf(employee.nationalIdCard.url)).expect(200);

    // مرفقات العقد بالترتيب نفسه، وتُستبدل عند التعديل
    const first = await uploadPng(tenant.adminToken, 'صفحة 1.png');
    const second = await uploadPng(tenant.adminToken, 'صفحة 2.png');
    const contract = data<{ id: string }>(
      await api()
        .post('/contracts')
        .set(auth(tenant.adminToken))
        .send({
          employeeId: created.id,
          contractType: 'دائم',
          startDate: '2026-01-01',
          annualLeaveDays: 30,
          attachmentFileIds: [first.id, second.id],
        })
        .expect(201),
    );
    const listed = data<{ id: string; attachments: FileView[] }[]>(
      await api().get('/contracts').set(auth(tenant.adminToken)).expect(200),
    );
    expect(
      listed
        .find((c) => c.id === contract.id)!
        .attachments.map((f) => f.name)
        .sort(),
    ).toEqual(['صفحة 1.png', 'صفحة 2.png']);

    await api()
      .patch(`/contracts/${contract.id}`)
      .set(auth(tenant.adminToken))
      .send({ attachmentFileIds: [second.id] })
      .expect(200);
    const updated = data<{ attachments: FileView[] }>(
      await api()
        .get(`/contracts/${contract.id}`)
        .set(auth(tenant.adminToken))
        .expect(200),
    );
    expect(updated.attachments.map((f) => f.id)).toEqual([second.id]);

    // إزالة الهوية
    const cleared = data<{ nationalIdCard: FileView | null }>(
      await api()
        .patch(`/employees/${created.id}`)
        .set(auth(tenant.adminToken))
        .send({ nationalIdCardFileId: null })
        .expect(200),
    );
    expect(cleared.nationalIdCard).toBeNull();
  });

  it('removes files nothing refers to after a day, and keeps the rest', async () => {
    const kept = await uploadPng(tenant.adminToken, 'مربوط.png');
    const orphan = await uploadPng(tenant.adminToken, 'متروك.png');
    const fresh = await uploadPng(tenant.adminToken, 'جديد.png');
    await api()
      .post('/employees')
      .set(auth(tenant.adminToken))
      .send({
        fullName: 'ليلى',
        nationalityType: 'saudi',
        nationalIdCardFileId: kept.id,
      })
      .expect(201);
    await dataSource.query(
      `UPDATE files SET "createdAt" = now() - interval '2 days' WHERE id = ANY($1)`,
      [[kept.id, orphan.id]],
    );

    const removed = await app.get(FilesCleanupService).removeOrphans();

    expect(removed).toBe(1);
    const left = await dataSource.query<{ id: string }[]>(
      `SELECT id FROM files ORDER BY id`,
    );
    expect(left.map((f) => f.id).sort()).toEqual([kept.id, fresh.id].sort());
    expect(
      existsSync(
        join(filesDir, tenant.tenantId, 'employee', `${orphan.id}.png`),
      ),
    ).toBe(false);
    await api().get(pathOf(orphan.url)).expect(404);
  });
});
