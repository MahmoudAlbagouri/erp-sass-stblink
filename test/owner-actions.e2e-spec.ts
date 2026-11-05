import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { UserStatus } from '../src/common/enums/user.enums';
import { Employee } from '../src/modules/employees/entities/employee.entity';
import type { FileView } from '../src/modules/files/entities/stored-file.entity';
import { Payroll } from '../src/modules/payroll/entities/payroll.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * ما يفعله مالك الشركة من الجوال: حذف مسودة المسير لإعادتها، إيقاف حساب يسري
 * فوراً، وسند صرف بصورة إيصاله.
 */
describe('Owner actions (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;
  const filesDir = mkdtempSync(join(tmpdir(), 'erp-owner-'));

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

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
      features: ['employees_module', 'payroll_module', 'accounting_module'],
      quotas: { max_users: 10 },
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('payroll draft', () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    beforeEach(async () => {
      await dataSource.getRepository(Employee).save({
        tenantId: tenant.tenantId,
        fullName: 'موظف المسير',
        employeeCode: `P${Date.now()}`,
        nationalId: `N${Date.now()}`,
        nationalityType: 'saudi',
        status: 'active',
      } as Partial<Employee>);
    });

    const generate = () =>
      api()
        .post(`/payroll/generate/${month}/${year}`)
        .set(auth(tenant.adminToken));

    it('deletes a draft so the month can be prepared again', async () => {
      const draft = data<{ id: string }>(await generate().expect(201));
      await generate().expect(400);

      await api()
        .delete(`/payroll/${draft.id}`)
        .set(auth(tenant.adminToken))
        .expect(200);

      await api()
        .get(`/payroll/${draft.id}`)
        .set(auth(tenant.adminToken))
        .expect((res) => expect(data(res)).toBeFalsy());
      await generate().expect(201);
    });

    it('never deletes a disbursed payroll', async () => {
      const draft = data<{ id: string }>(await generate().expect(201));
      // الصرف نفسه يسجّل من صرف (مستخدم حقيقي)؛ يكفي هنا أنه صُرف
      await dataSource
        .getRepository(Payroll)
        .update(draft.id, { isDisbursed: true, disbursedAt: new Date() });

      const refused = await api()
        .delete(`/payroll/${draft.id}`)
        .set(auth(tenant.adminToken))
        .expect(400);
      expect(refused.body.message).toContain('تم صرفه');
    });

    it('needs its own permission', async () => {
      const draft = data<{ id: string }>(await generate().expect(201));
      const preparer = tenant.tokenWith(['view_payroll', 'generate_payroll']);

      await api()
        .delete(`/payroll/${draft.id}`)
        .set(auth(preparer))
        .expect(403);
    });
  });

  describe('suspending a user', () => {
    const password = 'secret123';

    const userWith = async (email: string, isSuperAdmin = false) =>
      dataSource.getRepository(User).save({
        username: email.split('@')[0],
        email,
        password: await argon2.hash(password),
        status: UserStatus.ACTIVE,
        isSuperAdmin,
        isSystemAdmin: false,
        isEmailVerified: true,
        isDisclaimerAccepted: true,
        tenantId: tenant.tenantId,
      });
    const login = async (email: string) =>
      data<{ accessToken: string; refreshToken: string }>(
        await api().post('/auth/login').send({ email, password }).expect(201),
      );

    it('ends their sessions at once', async () => {
      const owner = await userWith('owner@co.test', true);
      const cashier = await userWith('cashier@co.test');
      const ownerTokens = await login(owner.email);
      const cashierTokens = await login(cashier.email);

      await api()
        .patch(`/users/${cashier.id}`)
        .set(auth(ownerTokens.accessToken))
        .send({ status: UserStatus.INACTIVE })
        .expect(200);

      // جلسته أُلغيت: لا يجدّد توكنه حتى لو أعيد تفعيله لاحقاً
      await api()
        .post('/auth/refresh')
        .set(auth(cashierTokens.refreshToken))
        .expect(401);
    });

    it('cannot suspend themselves', async () => {
      const owner = await userWith('owner@co.test', true);
      const { accessToken } = await login(owner.email);

      const refused = await api()
        .patch(`/users/${owner.id}`)
        .set(auth(accessToken))
        .send({ status: UserStatus.SUSPENDED })
        .expect(400);
      expect(refused.body.message).toContain('حسابك');
    });
  });

  describe('expense receipt', () => {
    interface Account {
      id: string;
      type: string;
      isGroup: boolean;
      isActive: boolean;
      systemKey: string | null;
    }

    const uploadReceipt = async (token = tenant.adminToken) =>
      data<FileView[]>(
        await api()
          .post('/files/expense')
          .set(auth(token))
          .attach('files', PNG, {
            filename: 'إيصال.png',
            contentType: 'image/png',
          })
          .expect(201),
      )[0];

    const voucher = async (receiptFileId: string) => {
      await api()
        .post('/accounting/activate')
        .set(auth(tenant.adminToken))
        .send({})
        .expect(201);
      const accounts = data<Account[]>(
        await api()
          .get('/accounting/accounts')
          .set(auth(tenant.adminToken))
          .expect(200),
      );
      const cash = accounts.find((a) => a.systemKey === 'cash')!;
      const expense = accounts.find(
        (a) => a.type === 'expense' && !a.isGroup && a.isActive && !a.systemKey,
      )!;
      return api()
        .post('/accounting/expenses')
        .set(auth(tenant.adminToken))
        .send({
          date: new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Riyadh',
          }).format(new Date()),
          paidFromAccountId: cash.id,
          payee: 'محطة الوقود',
          description: 'وقود سيارة التوزيع',
          receiptFileId,
          lines: [{ accountId: expense.id, amount: 150 }],
        });
    };

    it('keeps the receipt with the voucher', async () => {
      const receipt = await uploadReceipt();
      const res = await voucher(receipt.id);
      expect(res.status).toBe(201);
      const created = data<{ id: string }>(res);

      const view = data<{ receipt: FileView | null }>(
        await api()
          .get(`/accounting/expenses/${created.id}`)
          .set(auth(tenant.adminToken))
          .expect(200),
      );
      expect(view.receipt?.id).toBe(receipt.id);
      expect(view.receipt?.url).toContain(`/files/${receipt.id}/`);
    });

    it("refuses another company's file", async () => {
      const other = await createTenantFixture(dataSource);
      const foreign = await uploadReceipt(other.adminToken);

      expect((await voucher(foreign.id)).status).toBe(400);
    });
  });
});
