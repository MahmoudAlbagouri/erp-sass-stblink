import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { getJwtAccessSecret } from '../src/config/jwt.config';
import { AttendanceLog } from '../src/modules/attendance/entities/attendance-log.entity';
import { AuthSession } from '../src/modules/auth/entities/auth-session.entity';
import { Branch } from '../src/modules/branches/entities/branch.entity';
import { Employee } from '../src/modules/employees/entities/employee.entity';
import { PayrollItem } from '../src/modules/payroll/entities/payroll-item.entity';
import { Payroll } from '../src/modules/payroll/entities/payroll.entity';
import { Plan } from '../src/modules/plans/entities/plan.entity';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * ما يحتاجه تطبيق الموظف: البصمة من الجوال (الموقع، ربط الجهاز، الخطة)، تقرير
 * الموظف لنفسه، قسائمه، وجلسة الموبايل.
 */
describe('Mobile app (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  const BRANCH = { latitude: 24.7136, longitude: 46.6753 };
  // نحو 11 متراً و1.1 كم شمال الفرع
  const NEARBY = { latitude: 24.7137, longitude: 46.6753 };
  const FAR = { latitude: 24.7236, longitude: 46.6753 };

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;

  let sequence = 0;
  const employeeWith = async (fields: Partial<Employee> = {}) => {
    sequence += 1;
    const employee = await dataSource.getRepository(Employee).save({
      tenantId: tenant.tenantId,
      fullName: `موظف ${sequence}`,
      employeeCode: `M${Date.now()}${sequence}`,
      nationalId: `N${Date.now()}${sequence}`,
      nationalityType: 'saudi',
      status: 'active',
      mobilePunchEnabled: true,
      ...fields,
    } as Partial<Employee>);
    return { employee, token: tokenOf(employee.id) };
  };

  const tokenOf = (employeeId: string) =>
    new JwtService().sign(
      {
        sub: '00000000-0000-4000-a000-000000000002',
        tenantId: tenant.tenantId,
        isSuperAdmin: false,
        isSystemAdmin: false,
        isDisclaimerAccepted: true,
        employeeId,
        role: { id: 'r', name: 'موظف', permissions: [] },
      },
      { secret: getJwtAccessSecret(), expiresIn: '15m' },
    );

  const punch = (token: string, body: Record<string, unknown>) =>
    api()
      .post('/attendance/me/punch')
      .set(auth(token))
      .send({
        deviceId: 'device-a',
        deviceName: 'Pixel 8',
        ...NEARBY,
        ...body,
      });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    tenant = await createTenantFixture(dataSource, {
      features: ['attendance_module', 'mobile_attendance', 'payroll_module'],
    });
    await dataSource.getRepository(Branch).save({
      tenantId: tenant.tenantId,
      name: 'الفرع الرئيسي',
      isMain: true,
      ...BRANCH,
      punchRadiusMeters: 100,
    });
  });

  describe('punch', () => {
    it('records a punch inside the branch and binds the phone', async () => {
      const { employee, token } = await employeeWith();

      const res = await punch(token, {}).expect(201);
      const today = data<{ checkIn: string | null; punches: string[] }>(res);
      expect(today.checkIn).not.toBeNull();
      expect(today.punches).toHaveLength(1);

      const log = await dataSource
        .getRepository(AttendanceLog)
        .findOneByOrFail({ employeeId: employee.id });
      expect(log.verifyMode).toBe('mobile');
      expect(log.latitude).toBeCloseTo(NEARBY.latitude);
      expect(log.distanceMeters).toBeLessThan(20);

      const bound = await dataSource
        .getRepository(Employee)
        .findOneByOrFail({ id: employee.id });
      expect(bound.mobileDeviceId).toBe('device-a');
      expect(bound.mobileDeviceName).toBe('Pixel 8');
    });

    it('rejects a punch outside the branch radius, saying how far', async () => {
      const { employee, token } = await employeeWith();

      const res = await punch(token, FAR).expect(403);
      expect((res.body as { message: string }).message).toContain('خارج نطاق');
      expect(
        await dataSource
          .getRepository(AttendanceLog)
          .countBy({ employeeId: employee.id }),
      ).toBe(0);
    });

    it('rejects a mocked location and a weak reading', async () => {
      const { token } = await employeeWith();
      await punch(token, { isMocked: true }).expect(403);
      await punch(token, { accuracy: 500 }).expect(400);
    });

    it('accepts only the bound phone until a manager unbinds it', async () => {
      const { employee, token } = await employeeWith();
      await punch(token, {}).expect(201);
      await dataSource
        .getRepository(AttendanceLog)
        .update(
          { employeeId: employee.id },
          { punchTime: new Date(Date.now() - 5 * 60_000) },
        );

      await punch(token, { deviceId: 'device-b' }).expect(403);

      await api()
        .delete(`/attendance/mobile-devices/${employee.id}`)
        .set(auth(tenant.adminToken))
        .expect(200);
      await punch(token, { deviceId: 'device-b' }).expect(201);
    });

    it('refuses one phone for two employees in the same company', async () => {
      const first = await employeeWith();
      const second = await employeeWith();
      await punch(first.token, {}).expect(201);

      const res = await punch(second.token, {}).expect(403);
      expect((res.body as { message: string }).message).toContain('موظف آخر');
    });

    it('ignores a double tap', async () => {
      const { employee, token } = await employeeWith();
      await punch(token, {}).expect(201);
      await punch(token, {}).expect(400);
      expect(
        await dataSource
          .getRepository(AttendanceLog)
          .countBy({ employeeId: employee.id }),
      ).toBe(1);
    });

    it('is off unless the employee is enabled and the plan allows it', async () => {
      const disabled = await employeeWith({ mobilePunchEnabled: false });
      const today = await api()
        .get('/attendance/me/today')
        .set(auth(disabled.token))
        .expect(200);
      expect(
        data<{ mobilePunch: { allowed: boolean } }>(today).mobilePunch.allowed,
      ).toBe(false);
      await punch(disabled.token, {}).expect(403);

      tenant = await createTenantFixture(dataSource, {
        features: ['attendance_module'],
      });
      await dataSource.getRepository(Branch).save({
        tenantId: tenant.tenantId,
        name: 'الفرع الرئيسي',
        isMain: true,
        ...BRANCH,
      });
      const noPlan = await employeeWith();
      await punch(noPlan.token, {}).expect(403);
    });

    it('needs the branch location to be set', async () => {
      await dataSource
        .getRepository(Branch)
        .update({ tenantId: tenant.tenantId }, { latitude: null });
      const { token } = await employeeWith();
      await punch(token, {}).expect(403);
    });
  });

  describe('own attendance', () => {
    it('reports only the caller, and needs an employee file', async () => {
      const { employee, token } = await employeeWith();
      await punch(token, {}).expect(201);

      const now = new Date();
      const res = await api()
        .get('/attendance/me/month')
        .query({ month: now.getUTCMonth() + 1, year: now.getUTCFullYear() })
        .set(auth(token))
        .expect(200);
      const report = data<{ employeeId: string; presentDays: number }>(res);
      expect(report.employeeId).toBe(employee.id);
      expect(report.presentDays).toBe(1);

      await api()
        .get('/attendance/me/today')
        .set(auth(tenant.adminToken))
        .expect(404);
    });
  });

  describe('payslips', () => {
    const payrollFor = async (
      employeeId: string,
      isDisbursed: boolean,
      month: number,
    ) => {
      const payroll = await dataSource.getRepository(Payroll).save({
        tenantId: tenant.tenantId,
        month,
        year: 2026,
        paymentDate: new Date('2026-09-30'),
        isDisbursed,
      });
      return dataSource.getRepository(PayrollItem).save({
        payrollId: payroll.id,
        employeeId,
        basicSalary: 5000,
        housingAllowance: 1000,
        loanDeduction: 500,
        netSalary: 5500,
      });
    };

    it('shows disbursed payslips only, with their lines', async () => {
      const { employee, token } = await employeeWith();
      const paid = await payrollFor(employee.id, true, 8);
      await payrollFor(employee.id, false, 9);

      const list = await api().get('/payroll/me').set(auth(token)).expect(200);
      expect(data<{ id: string }[]>(list).map((row) => row.id)).toEqual([
        paid.id,
      ]);

      const detail = await api()
        .get(`/payroll/me/${paid.id}`)
        .set(auth(token))
        .expect(200);
      const payslip = data<{
        earnings: { label: string }[];
        deductions: { label: string }[];
        totalEarnings: string;
        totalDeductions: string;
      }>(detail);
      expect(payslip.earnings.map((line) => line.label)).toEqual([
        'الراتب الأساسي',
        'بدل السكن',
      ]);
      expect(payslip.deductions.map((line) => line.label)).toEqual([
        'قسط القرض',
      ]);
      expect(payslip.totalEarnings).toBe('6000');
      expect(payslip.totalDeductions).toBe('500');
    });

    it("hides another employee's payslip", async () => {
      const owner = await employeeWith();
      const other = await employeeWith();
      const item = await payrollFor(owner.employee.id, true, 8);

      await api()
        .get(`/payroll/me/${item.id}`)
        .set(auth(other.token))
        .expect(404);
    });
  });

  describe('session and app config', () => {
    it('reports the minimum app version without a session', async () => {
      const res = await api().get('/auth/app-config').expect(200);
      expect(
        data<{ minMobileVersion: string }>(res).minMobileVersion,
      ).toBeTruthy();
    });

    it('keeps a mobile session longer than a web one', async () => {
      await dataSource
        .getRepository(Plan)
        .save({ name: 'FREE', nameAr: 'مجانية', features: [], quotas: {} });
      const credentials = { email: 'mobile@test.com', password: 'secret123' };
      await api()
        .post('/auth/register')
        .send({
          companyName: 'شركة الجوال',
          country: 'SA',
          username: 'مدير',
          ...credentials,
        })
        .expect(201);

      const mobileLogin = await api()
        .post('/auth/login')
        .send({ ...credentials, client: 'mobile' })
        .expect(201);
      await api().post('/auth/login').send(credentials).expect(201);

      const sessions = await dataSource.getRepository(AuthSession).find();
      const mobile = sessions.find((row) => row.client === 'mobile')!;
      const web = sessions.find((row) => row.client === 'web')!;
      const days = (session: AuthSession) =>
        Math.round((session.expiresAt.getTime() - Date.now()) / 86_400_000);
      expect(days(mobile)).toBe(60);
      expect(days(web)).toBe(7);

      // توكن التجديد يعيش بعمر جلسته، والتجديد يمدّها بنفس العمر
      const { refreshToken } = data<{ refreshToken: string }>(mobileLogin);
      const claims = new JwtService().decode<{ exp: number; iat: number }>(
        refreshToken,
      );
      expect((claims.exp - claims.iat) / 86_400).toBe(60);
      await api().post('/auth/refresh').set(auth(refreshToken)).expect(201);
      const renewed = await dataSource
        .getRepository(AuthSession)
        .findOneByOrFail({ id: mobile.id });
      expect(days(renewed)).toBe(60);
    });
  });
});
