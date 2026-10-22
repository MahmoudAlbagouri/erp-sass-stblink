import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Department } from '../src/modules/departments/entities/department.entity';
import type { DashboardOverview } from '../src/modules/dashboard/dashboard.service';
import { Employee } from '../src/modules/employees/entities/employee.entity';
import { Payroll } from '../src/modules/payroll/entities/payroll.entity';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * الصفحة الرئيسية: أرقام مجمّعة في طلب واحد، وكل قسم يغيب إن لم تشمله الخطة
 * أو لم يملك المستخدم صلاحية عرضه.
 */
describe('Dashboard overview (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  const ALL_FEATURES = [
    'products_module',
    'inventory_module',
    'purchasing_module',
    'sales_module',
    'pos_module',
    'employees_module',
    'payroll_module',
    'attendance_module',
  ];

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
  const get = (path: string, token = tenant.adminToken) =>
    api().get(path).set(auth(token));
  const post = (path: string, body: object = {}, token = tenant.adminToken) =>
    api().post(path).set(auth(token)).send(body);

  const overview = async (query = '', token = tenant.adminToken) =>
    data<DashboardOverview>(await get(`/dashboard/overview${query}`, token));

  /** يبيع عبر الكاشير فاتورتين: اليوم (2 × 2.30) وقبل 40 يوماً (1 × 2.30) */
  const sellSomething = async () => {
    const units = data<{ id: string }[]>(await get('/catalog/units'));
    const productId = data<{ id: string }>(
      await post('/catalog/products', {
        name: 'مياه 330 مل',
        baseUnitId: units[0].id,
        salePrice: 2.3,
      }),
    ).id;
    const warehouses = data<{ id: string; type: string }[]>(
      await get('/inventory/warehouses'),
    );
    const warehouseId = warehouses.find((w) => w.type === 'main')!.id;
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
    const installationId = randomUUID();
    await post(`/pos/devices/${deviceId}/bind`, { installationId });

    const shiftId = randomUUID();
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const longAgo = new Date(Date.now() - 40 * 24 * 3600_000).toISOString();
    const sale = (counter: number, issuedAt: string, quantity: number) => ({
      id: `sale-${counter}`,
      type: 'sale',
      payload: {
        uuid: randomUUID(),
        number: `POS1-00000${counter}`,
        issuedAt,
        shiftId,
        pricesIncludeTax: true,
        lines: [
          {
            productId,
            quantity,
            unitPrice: 2.3,
            discount: 0,
            taxRate: 15,
            subtotal: 2 * quantity,
            taxAmount: 0.3 * quantity,
            total: 2.3 * quantity,
          },
        ],
        payments: [{ method: 'cash', amount: 2.3 * quantity }],
      },
    });

    const synced = await post('/pos/sync', {
      deviceId,
      installationId,
      operations: [
        {
          id: 'open',
          type: 'shift.open',
          payload: { id: shiftId, openedAt: longAgo, openingCash: 0 },
        },
        sale(1, longAgo, 1),
        sale(2, hourAgo, 2),
      ],
    });
    expect(
      data<{ results: { status: string }[] }>(synced).results.map(
        (r) => r.status,
      ),
    ).toEqual(['ok', 'ok', 'ok']);
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
    tenant = await createTenantFixture(dataSource, { features: ALL_FEATURES });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns every section, zero-filled, for a brand new company', async () => {
    const result = await overview();

    expect(result.range.days).toBe(30);
    expect(result.sales).toMatchObject({
      total: 0,
      invoices: 0,
      receivables: 0,
      paymentMethods: [],
      topProducts: [],
      openShifts: 0,
    });
    // كل يوم في الفترة حاضر ولو بلا مبيعات: الرسم لا تنقصه أيام
    expect(result.sales!.daily).toHaveLength(30);
    expect(result.sales!.daily[0].date).toBe(result.range.from);
    expect(result.sales!.daily[29].date).toBe(result.range.to);
    expect(result.purchasing).toMatchObject({ total: 0, payables: 0 });
    expect(result.inventory).toMatchObject({ value: 0, low: 0, negative: 0 });
    expect(result.hr).toMatchObject({
      employees: { active: 0, inactive: 0, terminated: 0 },
      departments: [],
      payroll: [],
    });
    expect(result.attendance).toMatchObject({ present: 0, late: 0, absent: 0 });
  });

  it('aggregates sales of the period and compares with the previous one', async () => {
    await sellSomething();

    const month = await overview();
    expect(month.sales).toMatchObject({
      total: 4.6,
      invoices: 1,
      // الفاتورة القديمة (قبل 40 يوماً) تقع في الفترة السابقة
      previousTotal: 2.3,
      previousInvoices: 1,
      // (2.00 − 1.00) × 2
      grossProfit: 2,
      paymentMethods: [{ method: 'cash', amount: 4.6 }],
      topProducts: [{ name: 'مياه 330 مل', quantity: 2, total: 4.6 }],
      openShifts: 1,
    });
    expect(month.sales!.daily.at(-1)).toMatchObject({
      total: 4.6,
      invoices: 1,
    });
    // 50 − 3 مباع، بتكلفة 1
    expect(month.inventory).toMatchObject({ value: 47 });

    const quarter = await overview('?days=90');
    expect(quarter.sales).toMatchObject({ total: 6.9, invoices: 2 });
    expect(quarter.sales!.daily).toHaveLength(90);
  });

  it('summarises the workforce', async () => {
    const departments = dataSource.getRepository(Department);
    const employees = dataSource.getRepository(Employee);
    const sales = await departments.save({
      name: 'المبيعات',
      tenantId: tenant.tenantId,
    });
    const person = (code: string, extra: Partial<Employee> = {}) =>
      employees.save({
        tenantId: tenant.tenantId,
        employeeCode: code,
        fullName: `موظف ${code}`,
        ...extra,
      });
    await person('1', { departmentId: sales.id });
    await person('2', { departmentId: sales.id });
    await person('3');
    await person('4', { status: 'terminated' });
    await dataSource.getRepository(Payroll).save([
      {
        tenantId: tenant.tenantId,
        month: 8,
        year: 2026,
        totalNetSalary: 9000,
        paymentDate: new Date(),
        isDisbursed: true,
      },
      {
        tenantId: tenant.tenantId,
        month: 9,
        year: 2026,
        totalNetSalary: 9500,
        paymentDate: new Date(),
      },
    ]);

    const { hr, attendance } = await overview();

    expect(hr).toMatchObject({
      employees: { active: 3, inactive: 0, terminated: 1 },
      departments: [
        { name: 'المبيعات', count: 2 },
        { name: 'بلا قسم', count: 1 },
      ],
      // الأقدم أولاً
      payroll: [
        { year: 2026, month: 8, total: 9000, paid: true },
        { year: 2026, month: 9, total: 9500, paid: false },
      ],
    });
    // لا بصمات اليوم: النشطون الثلاثة لم يسجّلوا حضوراً
    expect(attendance).toMatchObject({ present: 0, absent: 3 });
  });

  it('hides what the user may not see or the plan does not include', async () => {
    const hrOnly = await overview('', tenant.tokenWith(['view_employees']));
    expect(hrOnly.hr).not.toBeNull();
    expect(hrOnly.hr!.payroll).toBeNull();
    expect(hrOnly.sales).toBeNull();
    expect(hrOnly.purchasing).toBeNull();
    expect(hrOnly.inventory).toBeNull();
    expect(hrOnly.attendance).toBeNull();

    const none = await overview('', tenant.tokenWith([]));
    expect([none.sales, none.hr, none.inventory]).toEqual([null, null, null]);

    const hrPlan = await createTenantFixture(dataSource, {
      features: ['employees_module'],
    });
    const limited = await overview('', hrPlan.adminToken);
    expect(limited.hr).not.toBeNull();
    expect(limited.sales).toBeNull();
    expect(limited.inventory).toBeNull();
  });

  it('breaks sales down by hour, category, branch and cashier', async () => {
    await sellSomething();
    const { sales, branches } = await overview();

    expect(sales).toMatchObject({
      subtotal: 4,
      byCategory: [{ name: 'بلا تصنيف', total: 4.6 }],
      // عميل نقدي بلا اسم: لا يدخل قوائم العملاء
      topCustomers: [],
      topDebtors: [],
      cashiers: [{ name: 'بلا اسم', total: 4.6, invoices: 1 }],
    });
    expect(sales!.byHour).toHaveLength(24);
    expect(sales!.byHour.reduce((sum, h) => sum + h.total, 0)).toBeCloseTo(4.6);
    // الفترة السابقة يوماً بيوم، بنفس طول الحالية
    expect(sales!.previousDaily).toHaveLength(30);
    expect(sales!.previousDaily.reduce((sum, v) => sum + v, 0)).toBeCloseTo(
      2.3,
    );
    expect(sales!.recentInvoices).toHaveLength(2);
    expect(sales!.recentInvoices[0]).toMatchObject({
      number: 'POS1-000002',
      total: 4.6,
      remaining: 0,
    });
    expect(branches).toHaveLength(1);
    expect(sales!.branches).toMatchObject([
      { id: branches![0].id, total: 4.6, invoices: 1, grossProfit: 2 },
    ]);
  });

  it('counts what customers owe exactly as the customers page does', async () => {
    const units = data<{ id: string }[]>(await get('/catalog/units'));
    const productId = data<{ id: string }>(
      await post('/catalog/products', {
        name: 'مياه 330 مل',
        baseUnitId: units[0].id,
        salePrice: 2.3,
      }),
    ).id;
    const warehouses = data<{ id: string; type: string }[]>(
      await get('/inventory/warehouses'),
    );
    const warehouseId = warehouses.find((w) => w.type === 'main')!.id;
    await post('/inventory/adjustments', {
      warehouseId,
      type: 'opening',
      lines: [{ productId, quantity: 50, unitCost: 1 }],
    });
    const customer = (name: string, openingBalance = 0) =>
      post('/sales/customers', { name, openingBalance }).then(
        (res) => data<{ id: string }>(res).id,
      );
    const onAccount = (customerId: string, amount: number) =>
      post('/sales/payments', {
        customerId,
        paymentDate: '2026-10-12',
        amount,
        method: 'cash',
      });

    // عليه 100 قبل النظام + فاتورة 23 دفع منها 3 + 5 على الحساب = 115
    const owing = await customer('مطعم الريف', 100);
    const invoice = data<{ id: string }>(
      await post('/sales/invoices', {
        customerId: owing,
        warehouseId,
        invoiceDate: '2026-10-12',
        lines: [{ productId, quantity: 10, unitPrice: 2.3 }],
      }),
    );
    await post(`/sales/invoices/${invoice.id}/issue`, {
      payments: [{ method: 'cash', amount: 3 }],
    });
    await onAccount(owing, 5);
    // له رصيد عندنا: لا يُنقص ما على غيره
    await onAccount(await customer('مقهى النخيل'), 30);

    const customers = data<{ data: { balance: number }[] }>(
      await get('/sales/customers'),
    );
    const owedOnPage = customers.data
      .filter((c) => c.balance > 0)
      .reduce((sum, c) => sum + c.balance, 0);
    expect(owedOnPage).toBe(115);

    const { sales, branches } = await overview();
    expect(sales).toMatchObject({
      receivables: 115,
      receivablesBasis: 'balances',
      topDebtors: [{ name: 'مطعم الريف', total: 115 }],
    });
    const summary = data<{ receivables: number }>(await get('/sales/summary'));
    expect(summary.receivables).toBe(115);

    // الافتتاحي والقبض على الحساب بلا فرع: الفرع يرى المتبقي على فواتيره
    const scoped = await overview(`?branchId=${branches[0].id}`);
    expect(scoped.sales).toMatchObject({
      receivables: 20,
      receivablesBasis: 'invoices',
      topDebtors: [{ name: 'مطعم الريف', total: 20 }],
    });
  });

  it('scopes the numbers to one branch and still compares all branches', async () => {
    await sellSomething();
    const main = (await overview()).branches![0];
    const branch = data<{ id: string }>(
      await post('/branches', { name: 'فرع الشمال' }),
    );
    // للفرع مخزنان: أرقامه مجموعهما
    for (const name of ['مخزن الشمال', 'مستودع الشمال']) {
      await post('/inventory/warehouses', { name, branchId: branch.id });
    }

    const all = await overview();
    expect(all.branches!.map((b) => b.id)).toEqual([main.id, branch.id]);
    expect(all.sales!.total).toBe(4.6);

    // الفرع الجديد لم يبع شيئاً: أرقامه صفر، والمقارنة تعرض الفرعين
    const scoped = await overview(`?branchId=${branch.id}`);
    expect(scoped.branchId).toBe(branch.id);
    expect(scoped.sales).toMatchObject({
      total: 0,
      invoices: 0,
      paymentMethods: [],
      recentInvoices: [],
    });
    expect(scoped.inventory).toMatchObject({ value: 0 });
    expect(scoped.sales!.branches).toMatchObject([
      { id: main.id, total: 4.6 },
      { id: branch.id, total: 0 },
    ]);

    const other = await createTenantFixture(dataSource, {
      features: ALL_FEATURES,
    });
    expect(
      (await get(`/dashboard/overview?branchId=${main.id}`, other.adminToken))
        .status,
    ).toBe(400);
  });

  it('accepts a custom date range', async () => {
    await sellSomething();
    const { range } = await overview();

    // أسبوع ينتهي أمس: لا يشمل فاتورة اليوم
    const day = (offset: number) =>
      new Date(new Date(`${range.to}T00:00:00Z`).getTime() + offset * 86400000)
        .toISOString()
        .slice(0, 10);
    const week = await overview(`?from=${day(-7)}&to=${day(-1)}`);
    expect(week.range).toMatchObject({
      custom: true,
      days: 7,
      from: day(-7),
      to: day(-1),
      previousFrom: day(-14),
      previousTo: day(-8),
    });
    expect(week.sales).toMatchObject({ total: 0, invoices: 0 });
    expect(week.sales!.daily).toHaveLength(7);

    const single = await overview(`?from=${range.to}&to=${range.to}`);
    expect(single.range.days).toBe(1);
    expect(single.sales!.total).toBe(4.6);

    const bad = (query: string) =>
      get(`/dashboard/overview${query}`).then((res) => res.status);
    expect(await bad(`?from=${day(-1)}`)).toBe(400);
    expect(await bad(`?from=${day(0)}&to=${day(-3)}`)).toBe(400);
    expect(await bad(`?from=${day(-500)}&to=${day(0)}`)).toBe(400);
    expect(await bad('?from=2026-13-45&to=2026-13-46')).toBe(400);
  });

  it('flags what HR should follow up on', async () => {
    const employees = dataSource.getRepository(Employee);
    const inDays = (n: number) => new Date(Date.now() + n * 86400000);
    const person = (code: string, extra: Partial<Employee> = {}) =>
      employees.save({
        tenantId: tenant.tenantId,
        employeeCode: code,
        fullName: `موظف ${code}`,
        ...extra,
      });
    await person('1', { iqamaExpiryDate: inDays(10) });
    await person('2', { iqamaExpiryDate: inDays(-5) });
    await person('3', { iqamaExpiryDate: inDays(200) });
    await person('4', { iqamaExpiryDate: inDays(3), status: 'terminated' });

    const { hr } = await overview();

    expect(hr!.alerts).toMatchObject({
      // تنتهي قريباً + منتهية؛ البعيدة والموظف المنتهية خدمته لا يُحسبان
      residencyExpiring: 2,
      contractsEnding: 0,
      onLeaveToday: 0,
      newHires: 3,
    });
  });

  it('accepts only the supported ranges', async () => {
    expect((await get('/dashboard/overview?days=7')).status).toBe(200);
    expect((await get('/dashboard/overview?days=365')).status).toBe(400);
    expect((await get('/dashboard/overview?days=abc')).status).toBe(400);
    expect((await api().get('/dashboard/overview')).status).toBe(401);
  });
});
