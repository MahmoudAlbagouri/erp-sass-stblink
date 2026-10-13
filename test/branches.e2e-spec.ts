import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import type { DashboardOverview } from '../src/modules/dashboard/dashboard.service';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

interface Named {
  id: string;
  name: string;
}
interface Page<T> {
  data: T[];
  total: number;
}

/**
 * الفروع: كيان فوق المخازن. للفرع مخازنه وموظفوه وأجهزته، والمستخدم المقيَّد
 * بفروع لا يرى ولا يعدّل بيانات غيرها.
 */
describe('Branches (e2e)', () => {
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
  const STAFF_PERMISSIONS = [
    'view_branches',
    'view_inventory',
    'manage_warehouses',
    'adjust_stock',
    'manage_stock_transfers',
    'receive_stock_transfers',
    'view_sales',
    'manage_sales',
    'issue_sales',
    'manage_customer_payments',
    'view_pos',
    'manage_pos_devices',
    'view_employees',
    'create_employee',
    'update_employee',
    'view_users',
    'create_user',
    'view_attendance',
  ];
  const TODAY = new Date().toISOString().slice(0, 10);

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
  const get = (path: string, token = tenant.adminToken) =>
    api().get(path).set(auth(token));
  const post = (path: string, body: object = {}, token = tenant.adminToken) =>
    api().post(path).set(auth(token)).send(body);
  const patch = (path: string, body: object, token = tenant.adminToken) =>
    api().patch(path).set(auth(token)).send(body);
  const remove = (path: string, token = tenant.adminToken) =>
    api().delete(path).set(auth(token));

  const branches = async (token = tenant.adminToken) =>
    data<
      (Named & {
        isMain: boolean;
        warehousesCount: number;
        employeesCount: number;
        usersCount: number;
      })[]
    >(await get('/branches', token));

  /**
   * شركة بفرعين — الرئيسي والشمال — لكل منهما مخزن به رصيد، وفاتورة بيع صادرة
   * (10 نقداً)، وموظف. `north` توكن موظف مقيَّد بفرع الشمال.
   */
  const twoBranches = async () => {
    const main = (await branches())[0];
    const northBranch = data<Named>(
      await post('/branches', { name: 'فرع الشمال', address: 'حي الشمال' }),
    );
    const mainWarehouse = data<Named[]>(await get('/inventory/warehouses'))[0];
    const northWarehouse = data<Named>(
      await post('/inventory/warehouses', {
        name: 'مخزن الشمال',
        branchId: northBranch.id,
      }),
    );

    const units = data<Named[]>(await get('/catalog/units'));
    const productId = data<Named>(
      await post('/catalog/products', {
        name: 'مياه 330 مل',
        baseUnitId: units[0].id,
        salePrice: 10,
      }),
    ).id;

    const invoices: Record<string, string> = {};
    const employees: Record<string, string> = {};
    for (const [key, warehouse, branch] of [
      ['main', mainWarehouse, main],
      ['north', northWarehouse, northBranch],
    ] as const) {
      await post('/inventory/adjustments', {
        warehouseId: warehouse.id,
        type: 'opening',
        lines: [{ productId, quantity: 50, unitCost: 4 }],
      });
      const draft = data<Named>(
        await post('/sales/invoices', {
          warehouseId: warehouse.id,
          invoiceDate: TODAY,
          lines: [{ productId, quantity: 1, unitPrice: 10 }],
        }),
      );
      const issued = await post(`/sales/invoices/${draft.id}/issue`, {
        payments: [{ method: 'cash', amount: 10 }],
      });
      expect(issued.status).toBe(200);
      invoices[key] = draft.id;

      const employee = await post('/employees', {
        fullName: `موظف ${branch.name}`,
        nationalityType: 'saudi',
        branchId: branch.id,
      });
      expect(employee.status).toBe(201);
      employees[key] = data<Named>(employee).id;
    }

    return {
      main,
      northBranch,
      mainWarehouse,
      northWarehouse,
      productId,
      invoices,
      employees,
      north: tenant.tokenWith(STAFF_PERMISSIONS, [northBranch.id]),
      unrestricted: tenant.tokenWith(STAFF_PERMISSIONS),
    };
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

  // ══════════════════════════ الكيان ══════════════════════════

  it('gives every company a main branch that owns its main warehouse', async () => {
    const list = await branches();
    expect(list).toMatchObject([{ name: 'الفرع الرئيسي', isMain: true }]);

    const warehouses = data<(Named & { branchId: string })[]>(
      await get('/inventory/warehouses'),
    );
    expect(warehouses).toMatchObject([{ branchId: list[0].id }]);
    // لا يتكرر الرئيسي مع كل طلب
    expect(await branches()).toHaveLength(1);
    expect((await branches())[0].warehousesCount).toBe(1);
  });

  it('works for a company with no commercial modules at all', async () => {
    const hrOnly = await createTenantFixture(dataSource, {
      features: ['employees_module'],
    });
    const created = await post(
      '/branches',
      { name: 'فرع جدة' },
      hrOnly.adminToken,
    );
    expect(created.status).toBe(201);
    expect(
      (await branches(hrOnly.adminToken)).map((branch) => branch.name),
    ).toEqual(['الفرع الرئيسي', 'فرع جدة']);
  });

  it('creates, renames and protects branches', async () => {
    const created = await post('/branches', { name: 'فرع الشمال' });
    expect(created.status).toBe(201);
    const { id } = data<Named>(created);

    expect((await post('/branches', { name: 'فرع الشمال' })).status).toBe(409);
    expect((await post('/branches', { name: '' })).status).toBe(400);
    expect(
      data<Named>(await patch(`/branches/${id}`, { name: 'فرع الرياض' })).name,
    ).toBe('فرع الرياض');

    const main = (await branches())[0];
    expect((await remove(`/branches/${main.id}`)).status).toBe(400);
    expect(
      (await patch(`/branches/${main.id}`, { isActive: false })).status,
    ).toBe(400);

    // شركة أخرى لا ترى الفرع ولا تعدّله
    const other = await createTenantFixture(dataSource, {
      features: ALL_FEATURES,
    });
    expect(
      (await patch(`/branches/${id}`, { name: 'x' }, other.adminToken)).status,
    ).toBe(404);
    expect(
      (
        await post(
          '/inventory/warehouses',
          { name: 'مخزن', branchId: id },
          other.adminToken,
        )
      ).status,
    ).toBe(404);
  });

  it('requires permission to view and to manage', async () => {
    const viewer = tenant.tokenWith(['view_branches']);
    const nobody = tenant.tokenWith([]);

    expect((await get('/branches', viewer)).status).toBe(200);
    expect((await get('/branches', nobody)).status).toBe(403);
    expect((await post('/branches', { name: 'فرع' }, viewer)).status).toBe(403);
    // قائمة الاختيار تكفيها المصادقة: نموذج الموظف يحتاجها
    expect((await get('/branches/options', nobody)).status).toBe(200);
  });

  it('refuses to delete a branch that still owns warehouses or users', async () => {
    const { northBranch, northWarehouse, employees, main } =
      await twoBranches();

    expect((await remove(`/branches/${northBranch.id}`)).status).toBe(409);
    // لا يُوقف فرع ومخزنه يعمل
    expect(
      (await patch(`/branches/${northBranch.id}`, { isActive: false })).status,
    ).toBe(409);

    // بعد نقل مخزنه للرئيسي يُحذف، وموظفه ينتقل للرئيسي
    expect(
      (
        await patch(`/inventory/warehouses/${northWarehouse.id}`, {
          branchId: main.id,
        })
      ).status,
    ).toBe(200);
    expect((await remove(`/branches/${northBranch.id}`)).status).toBe(200);

    const moved = data<{ branchId: string }>(
      await get(`/employees/${employees.north}`),
    );
    expect(moved.branchId).toBe(main.id);
    expect((await branches())[0]).toMatchObject({
      warehousesCount: 2,
      employeesCount: 2,
    });
  });

  it('keeps a branch that users are restricted to', async () => {
    const empty = data<Named>(await post('/branches', { name: 'فرع فارغ' }));
    const user = await post('/users', {
      username: 'مدير الفرع',
      email: 'branch-manager@example.com',
      password: 'Secret#12345',
      branchIds: [empty.id],
    });
    expect(user.status).toBe(201);
    expect((await branches())[1].usersCount).toBe(1);

    // حذفه كان سيحوّل المستخدم إلى مستخدم يرى كل الفروع
    expect((await remove(`/branches/${empty.id}`)).status).toBe(409);

    await patch(`/users/${data<Named>(user).id}`, { branchIds: [] });
    expect((await remove(`/branches/${empty.id}`)).status).toBe(200);
  });

  // ══════════════════════════ نطاق المستخدم ══════════════════════════

  it('shows a restricted user only their branch', async () => {
    const ctx = await twoBranches();
    const { north } = ctx;

    expect((await branches(north)).map((b) => b.id)).toEqual([
      ctx.northBranch.id,
    ]);
    expect(
      data<Named[]>(await get('/inventory/warehouses', north)).map((w) => w.id),
    ).toEqual([ctx.northWarehouse.id]);

    const invoices = data<Page<Named>>(await get('/sales/invoices', north));
    expect(invoices.data.map((i) => i.id)).toEqual([ctx.invoices.north]);
    expect(
      (await get(`/sales/invoices/${ctx.invoices.north}`, north)).status,
    ).toBe(200);
    // فاتورة فرع آخر: كأنها غير موجودة
    expect(
      (await get(`/sales/invoices/${ctx.invoices.main}`, north)).status,
    ).toBe(404);

    const levels = data<Page<{ warehouseId: string }>>(
      await get('/inventory/stock', north),
    );
    expect(levels.data.map((l) => l.warehouseId)).toEqual([
      ctx.northWarehouse.id,
    ]);
    const movements = data<Page<{ warehouseId: string }>>(
      await get('/inventory/movements', north),
    );
    expect(new Set(movements.data.map((m) => m.warehouseId))).toEqual(
      new Set([ctx.northWarehouse.id]),
    );

    const payments = data<Page<{ branchId: string }>>(
      await get('/sales/payments', north),
    );
    expect(payments.data.map((p) => p.branchId)).toEqual([ctx.northBranch.id]);

    const employees = data<Named[]>(await get('/employees', north));
    expect(employees.map((e) => e.id)).toEqual([ctx.employees.north]);
    expect((await get(`/employees/${ctx.employees.main}`, north)).status).toBe(
      404,
    );

    // من لا قيد عليه يرى الكل، كما كان
    const all = data<Page<Named>>(
      await get('/sales/invoices', ctx.unrestricted),
    );
    expect(all.total).toBe(2);
  });

  it('stops a restricted user from acting on another branch', async () => {
    const ctx = await twoBranches();
    const { north } = ctx;
    const line = { productId: ctx.productId, quantity: 1, unitPrice: 10 };

    // بيع من مخزن فرع آخر
    expect(
      (
        await post(
          '/sales/invoices',
          {
            warehouseId: ctx.mainWarehouse.id,
            invoiceDate: TODAY,
            lines: [line],
          },
          north,
        )
      ).status,
    ).toBe(403);
    // ومن مخزنه: مسموح
    expect(
      (
        await post(
          '/sales/invoices',
          {
            warehouseId: ctx.northWarehouse.id,
            invoiceDate: TODAY,
            lines: [line],
          },
          north,
        )
      ).status,
    ).toBe(201);

    // تسوية رصيد مخزن فرع آخر
    expect(
      (
        await post(
          '/inventory/adjustments',
          {
            warehouseId: ctx.mainWarehouse.id,
            type: 'opening',
            lines: [{ productId: ctx.productId, quantity: 5, unitCost: 1 }],
          },
          north,
        )
      ).status,
    ).toBe(403);

    // قبض على فاتورة فرع آخر، وتعديل موظف فرع آخر
    expect(
      (
        await post(
          '/sales/payments',
          { invoiceId: ctx.invoices.main, paymentDate: TODAY, amount: 1 },
          north,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await patch(
          `/employees/${ctx.employees.main}`,
          { jobTitle: 'x' },
          north,
        )
      ).status,
    ).toBe(404);

    // مخزن أو موظف جديد في فرع آخر
    expect(
      (
        await post(
          '/inventory/warehouses',
          { name: 'مخزن دخيل', branchId: ctx.main.id },
          north,
        )
      ).status,
    ).toBe(403);
    const hired = await post(
      '/employees',
      { fullName: 'موظف جديد', nationalityType: 'saudi' },
      north,
    );
    // بلا اختيار فرع: يُنسب لفرع من أضافه لا للرئيسي
    expect(data<{ branchId: string }>(hired).branchId).toBe(ctx.northBranch.id);
  });

  it('lets two branches move stock between them, each on its own side', async () => {
    const ctx = await twoBranches();
    const { north } = ctx;
    const mainOnly = tenant.tokenWith(STAFF_PERMISSIONS, [ctx.main.id]);
    const stranger = data<Named>(await post('/branches', { name: 'فرع ثالث' }));
    const thirdOnly = tenant.tokenWith(STAFF_PERMISSIONS, [stranger.id]);

    // الشمال يطلب من الرئيسي: يُنشئ الطلب، لكن لا يُخرج بضاعة مخزن غيره
    const created = await post(
      '/inventory/transfers',
      {
        fromWarehouseId: ctx.mainWarehouse.id,
        toWarehouseId: ctx.northWarehouse.id,
        lines: [{ productId: ctx.productId, quantity: 5 }],
      },
      north,
    );
    expect(created.status).toBe(201);
    const { id } = data<Named>(created);

    expect(
      (await post(`/inventory/transfers/${id}/send`, {}, north)).status,
    ).toBe(403);
    expect(
      (await post(`/inventory/transfers/${id}/send`, {}, mainOnly)).status,
    ).toBeLessThan(300);

    // الطرفان يريانه، وفرع ثالث لا
    for (const token of [north, mainOnly]) {
      expect(
        data<Page<Named>>(await get('/inventory/transfers', token)).total,
      ).toBe(1);
    }
    expect(
      data<Page<Named>>(await get('/inventory/transfers', thirdOnly)).total,
    ).toBe(0);
    expect((await get(`/inventory/transfers/${id}`, thirdOnly)).status).toBe(
      404,
    );
  });

  it('never lets a restricted user hand out wider access than their own', async () => {
    const ctx = await twoBranches();

    const created = await post(
      '/users',
      {
        username: 'موظف الشمال',
        email: 'north-staff@example.com',
        password: 'Secret#12345',
      },
      ctx.north,
    );
    expect(created.status).toBe(201);
    // بلا اختيار: يرث فروع من أنشأه بدل "كل الفروع"
    const user = data<{ branches: Named[] }>(
      await get(`/users/${data<Named>(created).id}`),
    );
    expect(user.branches.map((b) => b.id)).toEqual([ctx.northBranch.id]);

    expect(
      (
        await post(
          '/users',
          {
            username: 'دخيل',
            email: 'intruder@example.com',
            password: 'Secret#12345',
            branchIds: [ctx.main.id],
          },
          ctx.north,
        )
      ).status,
    ).toBe(403);
  });

  // ══════════════════════════ الصفحة الرئيسية ══════════════════════════

  it('reports the dashboard per branch', async () => {
    const ctx = await twoBranches();
    const overview = async (query = '', token = tenant.adminToken) =>
      data<DashboardOverview>(await get(`/dashboard/overview${query}`, token));

    const all = await overview();
    expect(all.sales!.total).toBe(20);
    expect(all.sales!.branches).toHaveLength(2);
    expect(all.hr!.employees.active).toBe(2);
    expect(all.hr!.branches).toEqual(
      expect.arrayContaining([
        { name: 'الفرع الرئيسي', count: 1 },
        { name: 'فرع الشمال', count: 1 },
      ]),
    );

    const north = await overview(`?branchId=${ctx.northBranch.id}`);
    expect(north.sales).toMatchObject({
      total: 10,
      invoices: 1,
      paymentMethods: [{ method: 'cash', amount: 10 }],
    });
    expect(north.inventory!.value).toBe(196); // 49 × 4
    expect(north.hr!.employees.active).toBe(1);
    expect(north.hr!.payroll).toBeNull();

    // المقيَّد بالشمال: نفس أرقام الشمال، ولا يظهر له فرع غيره حتى في المقارنة
    const restricted = await overview('', ctx.north);
    expect(restricted.branches.map((b) => b.id)).toEqual([ctx.northBranch.id]);
    expect(restricted.sales!.total).toBe(10);
    expect(restricted.sales!.branches.map((b) => b.id)).toEqual([
      ctx.northBranch.id,
    ]);
    expect(restricted.hr!.employees.active).toBe(1);
    expect(
      (await get(`/dashboard/overview?branchId=${ctx.main.id}`, ctx.north))
        .status,
    ).toBe(400);
  });
});
