import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * المحاسبة: التفعيل (الشجرة والقيد الافتتاحي بأرصدة اللحظة)، ترحيل المستندات
 * بعدها (مرة واحدة)، القيود اليدوية وعكسها، قفل الفترة، حماية الشجرة —
 * والأستاذ العام يطابق الدفاتر المساعدة (العملاء، الموردون، المخزون).
 */
describe('Accounting (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  const FEATURES = [
    'products_module',
    'inventory_module',
    'purchasing_module',
    'sales_module',
    'accounting_module',
  ];
  /** اليوم بتوقيت الشركة (السعودية) */
  const TODAY = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
  }).format(new Date());
  const nextDay = (date: string) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
  const get = (path: string, token = tenant.adminToken) =>
    api().get(path).set(auth(token));
  const post = (path: string, body: object = {}, token = tenant.adminToken) =>
    api().post(path).set(auth(token)).send(body);
  const patch = (path: string, body: object = {}) =>
    api().patch(path).set(auth(tenant.adminToken)).send(body);

  interface Account {
    id: string;
    code: string;
    name: string;
    isGroup: boolean;
    systemKey: string | null;
  }
  interface Entry {
    id: string;
    number: string;
    date: string;
    documentDate: string | null;
    sourceType: string;
    total: number;
  }

  const accounts = async () =>
    data<Account[]>(await get('/accounting/accounts'));
  const byKey = async (key: string) =>
    (await accounts()).find((a) => a.systemKey === key)!;
  const ledgerClosing = async (accountId: string) =>
    data<{ closing: number }>(
      await get(
        `/accounting/reports/ledger?accountId=${accountId}&from=2000-01-01&to=2099-12-31`,
      ),
    ).closing;
  const entries = async (query = '') =>
    data<{ total: number; data: Entry[] }>(
      await get(`/accounting/journals?limit=100${query}`),
    );

  /** صنف، مخزن، مورد، وعميل برصيد افتتاحي 100 */
  const setup = async () => {
    const units = data<{ id: string }[]>(await get('/catalog/units'));
    const productId = data<{ id: string }>(
      await post('/catalog/products', {
        name: 'مياه 330 مل',
        baseUnitId: units[0].id,
        salePrice: 2.3,
      }),
    ).id;
    const warehouseId = data<{ id: string; type: string }[]>(
      await get('/inventory/warehouses'),
    ).find((w) => w.type === 'main')!.id;
    const supplierId = data<{ id: string }>(
      await post('/purchasing/suppliers', { name: 'مؤسسة التوريد' }),
    ).id;
    const customerId = data<{ id: string }>(
      await post('/sales/customers', {
        name: 'مطعم الريف',
        openingBalance: 100,
      }),
    ).id;
    return { productId, warehouseId, supplierId, customerId };
  };

  const sell = async (
    ctx: Awaited<ReturnType<typeof setup>>,
    options: { customerId?: string; quantity: number; paid: number },
  ) => {
    const draft = data<{ id: string; lines: { id: string }[] }>(
      await post('/sales/invoices', {
        customerId: options.customerId,
        warehouseId: ctx.warehouseId,
        invoiceDate: TODAY,
        lines: [
          {
            productId: ctx.productId,
            quantity: options.quantity,
            unitPrice: 2.3,
          },
        ],
      }),
    );
    const issued = await post(`/sales/invoices/${draft.id}/issue`, {
      payments: options.paid ? [{ method: 'cash', amount: options.paid }] : [],
    });
    expect(issued.status).toBe(200);
    return draft;
  };

  const buy = async (
    ctx: Awaited<ReturnType<typeof setup>>,
    quantity: number,
  ) => {
    const invoice = data<{ id: string }>(
      await post('/purchasing/invoices', {
        supplierId: ctx.supplierId,
        warehouseId: ctx.warehouseId,
        invoiceDate: TODAY,
        lines: [{ productId: ctx.productId, quantity, unitPrice: 1.5 }],
      }),
    );
    expect((await post(`/purchasing/invoices/${invoice.id}/post`)).status).toBe(
      200,
    );
    return invoice;
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
    tenant = await createTenantFixture(dataSource, { features: FEATURES });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('activates with an opening entry, posts every document once, and the ledger matches the subledgers', async () => {
    const ctx = await setup();
    // ─── قبل التفعيل: تدخل في القيد الافتتاحي ───
    await post('/inventory/adjustments', {
      warehouseId: ctx.warehouseId,
      type: 'opening',
      lines: [{ productId: ctx.productId, quantity: 50, unitCost: 1 }],
    });
    await sell(ctx, { customerId: ctx.customerId, quantity: 10, paid: 10 });
    await buy(ctx, 100);

    expect(
      data<{ active: boolean }>(await get('/accounting/status')).active,
    ).toBe(false);
    const activated = await post('/accounting/activate', {});
    expect(activated.status).toBe(201);
    expect(data<{ active: boolean }>(activated).active).toBe(true);
    expect((await post('/accounting/activate', {})).status).toBe(409);

    const opening = (await entries()).data;
    expect(opening).toEqual([
      expect.objectContaining({ sourceType: 'opening', date: TODAY }),
    ]);
    const receivables = await byKey('receivables');
    const payables = await byKey('payables');
    const inventory = await byKey('inventory');
    const customerBalance = async () =>
      data<{ balance: number }>(await get(`/sales/customers/${ctx.customerId}`))
        .balance;
    const supplierBalance = async () =>
      data<{ balance: number }>(
        await get(`/purchasing/suppliers/${ctx.supplierId}`),
      ).balance;
    const stockValue = async () =>
      data<{ value: number }>(await get('/inventory/stock/summary')).value;

    // الافتتاحي = أرصدة اللحظة
    expect(await ledgerClosing(receivables.id)).toBe(await customerBalance());
    expect(await ledgerClosing(payables.id)).toBe(-(await supplierBalance()));
    expect(
      Math.abs((await ledgerClosing(inventory.id)) - (await stockValue())),
    ).toBeLessThan(0.05);

    // ─── بعد التفعيل: كل مستند يُرحَّل ───
    const walkIn = await sell(ctx, { quantity: 5, paid: 11.5 });
    const receipt = data<{ id: string }>(
      await post('/sales/payments', {
        customerId: ctx.customerId,
        paymentDate: TODAY,
        amount: 13,
        method: 'bank_transfer',
      }),
    );
    expect((await post(`/sales/payments/${receipt.id}/cancel`)).status).toBe(
      200,
    );
    await buy(ctx, 10);
    await post('/purchasing/payments', {
      supplierId: ctx.supplierId,
      paymentDate: TODAY,
      amount: 50,
      method: 'cash',
    });
    await post('/inventory/adjustments', {
      warehouseId: ctx.warehouseId,
      type: 'adjustment',
      lines: [{ productId: ctx.productId, quantity: -2 }],
    });
    expect(walkIn.id).toBeTruthy();

    const synced = data<{ posted: number; failed: number }>(
      await post('/accounting/sync'),
    );
    expect(synced.failed).toBe(0);
    // فاتورة + قبضها، سند قبض + إلغاؤه، فاتورة شراء، سداد، تسوية مخزون
    expect(synced.posted).toBe(7);
    // مرة واحدة: إعادة الترحيل لا تكرر شيئاً
    expect(
      data<{ posted: number }>(await post('/accounting/sync')).posted,
    ).toBe(0);
    expect((await entries()).total).toBe(8);

    const status = data<{ errorsCount: number }>(
      await get('/accounting/status'),
    );
    expect(status.errorsCount).toBe(0);

    // الأستاذ العام = الدفاتر المساعدة
    expect(await ledgerClosing(receivables.id)).toBe(await customerBalance());
    expect(await ledgerClosing(payables.id)).toBe(-(await supplierBalance()));
    expect(
      Math.abs((await ledgerClosing(inventory.id)) - (await stockValue())),
    ).toBeLessThan(0.05);

    // ميزان المراجعة متوازن، والميزانية متوازنة
    const trial = data<{
      totals: { debit: number; credit: number; closing: number };
    }>(
      await get(`/accounting/reports/trial-balance?from=${TODAY}&to=${TODAY}`),
    );
    expect(trial.totals.debit).toBe(trial.totals.credit);
    expect(trial.totals.closing).toBe(0);
    const sheet = data<{ totals: { balanced: boolean } }>(
      await get(`/accounting/reports/balance-sheet?asOf=${TODAY}`),
    );
    expect(sheet.totals.balanced).toBe(true);

    // قائمة الدخل: المبيعات بعد التفعيل فقط (5 × 2.3 شاملة الضريبة = 10 صافي)
    const income = data<{
      totals: {
        revenue: number;
        netProfit: number;
        grossProfit: number | null;
      };
    }>(
      await get(
        `/accounting/reports/income-statement?from=${TODAY}&to=${TODAY}`,
      ),
    );
    expect(income.totals.revenue).toBe(10);
    expect(income.totals.grossProfit).not.toBeNull();
  });

  it('records manual entries, reverses them, and respects the period lock', async () => {
    const ctx = await setup();
    await post('/inventory/adjustments', {
      warehouseId: ctx.warehouseId,
      type: 'opening',
      lines: [{ productId: ctx.productId, quantity: 5, unitCost: 1 }],
    });
    await post('/accounting/activate', {});
    const cash = await byKey('cash');
    const capital = await byKey('capital');
    const assetsGroup = (await accounts()).find((a) => a.code === '1101')!;

    const manual = (body: object) => post('/accounting/journals', body);
    // غير متوازن، أو على حساب تجميعي، أو سطر بطرفين: يُرفض
    expect(
      (
        await manual({
          date: TODAY,
          description: 'x',
          lines: [
            { accountId: cash.id, debit: 100 },
            { accountId: capital.id, credit: 90 },
          ],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await manual({
          date: TODAY,
          description: 'x',
          lines: [
            { accountId: assetsGroup.id, debit: 100 },
            { accountId: capital.id, credit: 100 },
          ],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await manual({
          date: TODAY,
          description: 'x',
          lines: [
            { accountId: cash.id, debit: 100, credit: 100 },
            { accountId: capital.id, credit: 100 },
          ],
        })
      ).status,
    ).toBe(400);

    const created = await manual({
      date: TODAY,
      description: 'إيداع رأس المال',
      lines: [
        { accountId: cash.id, debit: 1000 },
        { accountId: capital.id, credit: 1000 },
      ],
    });
    expect(created.status).toBe(201);
    const entry = data<{ id: string; total: number; lines: unknown[] }>(
      created,
    );
    expect(entry).toMatchObject({ total: 1000 });
    expect(entry.lines).toHaveLength(2);
    expect(await ledgerClosing(cash.id)).toBe(1000);

    const reversal = await post(`/accounting/journals/${entry.id}/reverse`, {
      date: TODAY,
    });
    expect(reversal.status).toBe(201);
    expect(await ledgerClosing(cash.id)).toBe(0);
    expect(
      (await post(`/accounting/journals/${entry.id}/reverse`, { date: TODAY }))
        .status,
    ).toBe(409);

    // قيد مستند لا يُعكس يدوياً
    await sell(ctx, { customerId: ctx.customerId, quantity: 1, paid: 0 });
    await post('/accounting/sync');
    const invoiceEntry = (await entries('&sourceType=sales_invoice')).data[0];
    expect(
      (
        await post(`/accounting/journals/${invoiceEntry.id}/reverse`, {
          date: TODAY,
        })
      ).status,
    ).toBe(400);

    // قفل الفترة: اليدوي فيها يُرفض، والمستند بتاريخها يُقيَّد في أول يوم مفتوح
    expect(
      (await patch('/accounting/settings', { lockDate: TODAY })).status,
    ).toBe(200);
    expect(
      (
        await manual({
          date: TODAY,
          description: 'متأخر',
          lines: [
            { accountId: cash.id, debit: 5 },
            { accountId: capital.id, credit: 5 },
          ],
        })
      ).status,
    ).toBe(400);
    await post('/sales/payments', {
      customerId: ctx.customerId,
      paymentDate: TODAY,
      amount: 7,
      method: 'cash',
    });
    await post('/accounting/sync');
    const late = (await entries('&sourceType=customer_payment')).data[0];
    expect(late).toMatchObject({ date: nextDay(TODAY), documentDate: TODAY });
    // لا قفل لفترة لم تنتهِ
    expect(
      (await patch('/accounting/settings', { lockDate: nextDay(TODAY) }))
        .status,
    ).toBe(400);
  });

  it('protects the chart: codes under their parent, system accounts, accounts with entries', async () => {
    await post('/accounting/activate', {});
    const all = await accounts();
    const cashGroup = all.find((a) => a.code === '1101')!;
    const cash = all.find((a) => a.systemKey === 'cash')!;
    const capital = all.find((a) => a.systemKey === 'capital')!;

    // الكود التالي تلقائياً
    const safe = data<Account>(
      await post('/accounting/accounts', {
        parentId: cashGroup.id,
        name: 'خزنة الفرع',
      }),
    );
    expect(safe.code).toBe('110106');
    // كود خارج أبيه أو مكرر
    expect(
      (
        await post('/accounting/accounts', {
          parentId: cashGroup.id,
          name: 'x',
          code: '2109',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post('/accounting/accounts', {
          parentId: cashGroup.id,
          name: 'x',
          code: '110106',
        })
      ).status,
    ).toBe(409);
    // لا ابن تحت حساب فرعي
    expect(
      (await post('/accounting/accounts', { parentId: cash.id, name: 'x' }))
        .status,
    ).toBe(400);

    // حساب النظام لا يُحذف ولا يُوقف
    expect(
      (
        await api()
          .delete(`/accounting/accounts/${cash.id}`)
          .set(auth(tenant.adminToken))
      ).status,
    ).toBe(400);
    expect(
      (await patch(`/accounting/accounts/${cash.id}`, { isActive: false }))
        .status,
    ).toBe(400);

    // عليه قيود: لا يُحذف (يُوقف)
    await post('/accounting/journals', {
      date: TODAY,
      description: 'تمويل الخزنة',
      lines: [
        { accountId: safe.id, debit: 50 },
        { accountId: capital.id, credit: 50 },
      ],
    });
    expect(
      (
        await api()
          .delete(`/accounting/accounts/${safe.id}`)
          .set(auth(tenant.adminToken))
      ).status,
    ).toBe(409);
    expect(
      (await patch(`/accounting/accounts/${safe.id}`, { isActive: false }))
        .status,
    ).toBe(200);

    // حساب بلا قيود يُحذف
    const spare = data<Account>(
      await post('/accounting/accounts', {
        parentId: cashGroup.id,
        name: 'احتياطي',
      }),
    );
    expect(
      (
        await api()
          .delete(`/accounting/accounts/${spare.id}`)
          .set(auth(tenant.adminToken))
      ).status,
    ).toBe(204);
  });

  it('posts loans, advances and a disbursed payroll — and guards their status transitions', async () => {
    const hr = await createTenantFixture(dataSource, {
      features: [
        'employees_module',
        'payroll_module',
        'advances_module',
        'loans_module',
        'accounting_module',
      ],
    });
    const as = hr.adminToken;
    // الصرف يسجّل من صرف (مفتاح أجنبي على users): مدير الشركة موجود فعلاً
    const adminId = (
      JSON.parse(Buffer.from(as.split('.')[1], 'base64url').toString()) as {
        sub: string;
      }
    ).sub;
    await dataSource.query(
      `INSERT INTO users ("id", "username", "email", "password", "isSuperAdmin", "tenant_id")
       VALUES ($1, 'admin', $2, 'x', true, $3)`,
      [adminId, `admin-${adminId}@test.local`, hr.tenantId],
    );
    const employeeId = data<{ id: string }>(
      await post(
        '/employees',
        { fullName: 'أحمد سالم', nationalityType: 'saudi' },
        as,
      ),
    ).id;
    expect(
      (
        await post(
          '/salaries',
          {
            employeeId,
            basicSalary: 5000,
            housingAllowance: 1000,
            paymentMethod: 'CASH',
          },
          as,
        )
      ).status,
    ).toBe(201);
    expect((await post('/accounting/activate', {}, as)).status).toBe(201);

    const [year, month] = TODAY.split('-').map(Number);
    const firstOfMonth = `${TODAY.slice(0, 7)}-01`;
    const status = (path: string, value: string) =>
      api().patch(path).set(auth(as)).send({ status: value });

    // قرض 3000 على 3 أقساط
    const loanId = data<{ id: string }>(
      await post(
        `/loans/admin/${employeeId}`,
        { totalAmount: 3000, installmentsCount: 3, startDate: firstOfMonth },
        as,
      ),
    ).id;
    expect((await status(`/loans/${loanId}/status`, 'bogus')).status).toBe(400);
    expect((await status(`/loans/${loanId}/status`, 'approved')).status).toBe(
      200,
    );
    // لا رجوع ولا إكمال يدوي
    expect((await status(`/loans/${loanId}/status`, 'pending')).status).toBe(
      400,
    );
    expect((await status(`/loans/${loanId}/status`, 'completed')).status).toBe(
      400,
    );

    // سلفة 500 تُسلَّم الآن وتُخصم هذا الشهر
    const advanceId = data<{ id: string }>(
      await post(
        `/advances/admin/${employeeId}`,
        { amount: 500, repaymentDate: TODAY },
        as,
      ),
    ).id;
    expect(
      (await status(`/advances/${advanceId}/status`, 'approved')).status,
    ).toBe(200);
    expect(
      (await api().patch(`/advances/${advanceId}/disburse`).set(auth(as)))
        .status,
    ).toBe(200);
    // سُلّمت: لا تُرفض بعدها
    expect(
      (await status(`/advances/${advanceId}/status`, 'rejected')).status,
    ).toBe(400);

    const payroll = data<{ id: string }>(
      await post(`/payroll/generate/${month}/${year}`, {}, as),
    );
    expect(
      (await api().patch(`/payroll/${payroll.id}/disburse`).set(auth(as)))
        .status,
    ).toBe(200);

    const synced = data<{ posted: number; failed: number }>(
      await post('/accounting/sync', {}, as),
    );
    expect(synced).toMatchObject({ posted: 3, failed: 0 });

    const chart = data<Account[]>(await get('/accounting/accounts', as));
    const key = (k: string) => chart.find((a) => a.systemKey === k)!.id;
    const closing = async (k: string) =>
      data<{ closing: number }>(
        await get(
          `/accounting/reports/ledger?accountId=${key(k)}&from=2000-01-01&to=2099-12-31`,
          as,
        ),
      ).closing;
    // القرض: 3000 سُلّم − قسط 1000 خُصم
    expect(await closing('employee_loans')).toBe(2000);
    // السلفة: سُلّمت وخُصمت كاملة
    expect(await closing('employee_advances')).toBe(0);
    expect(await closing('salaries')).toBe(5000);
    expect(await closing('allowances')).toBe(1000);
    // من الصندوق: القرض 3000 + السلفة 500 + الصافي (6000 − 1000 − 500)
    expect(await closing('cash')).toBe(-8000);

    const trial = data<{ totals: { debit: number; credit: number } }>(
      await get(
        `/accounting/reports/trial-balance?from=${TODAY}&to=${TODAY}`,
        as,
      ),
    );
    expect(trial.totals.debit).toBe(trial.totals.credit);
  });

  it('is company-wide: blocked for branch-restricted users and plans without the module', async () => {
    await post('/accounting/activate', {});
    const branchId = data<{ id: string }[]>(await get('/branches'))[0].id;
    const restricted = tenant.tokenWith(['view_accounting'], [branchId]);
    expect((await get('/accounting/status', restricted)).status).toBe(403);
    const viewer = tenant.tokenWith(['view_accounting']);
    expect((await get('/accounting/status', viewer)).status).toBe(200);
    expect((await post('/accounting/journals', {}, viewer)).status).toBe(403);

    const other = await createTenantFixture(dataSource, {
      features: ['products_module'],
    });
    expect((await get('/accounting/status', other.adminToken)).status).toBe(
      403,
    );
  });
});
