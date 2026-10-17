import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

/**
 * المحاسبة (2): سندات الصرف وإلغاؤها، إقرار ضريبة القيمة المضافة من
 * المستندات ومطابقته مع الدفاتر، إقفال السنة وإعادة فتحها، وتصدير التقارير.
 */
describe('Accounting — vouchers, VAT return, year-end, exports (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  const FEATURES = [
    'products_module',
    'inventory_module',
    'purchasing_module',
    'sales_module',
    'accounting_module',
    'reports_export',
  ];
  const TODAY = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
  }).format(new Date());
  const LAST_YEAR = Number(TODAY.slice(0, 4)) - 1;

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
    systemKey: string | null;
    type: string;
    isGroup: boolean;
  }
  interface Voucher {
    id: string;
    number: string;
    status: string;
    subtotal: number;
    taxTotal: number;
    total: number;
    taxRecoverable: boolean;
    journalEntryId: string | null;
    cancelJournalEntryId: string | null;
    lines: { accountName: string; taxAmount: number }[];
  }
  interface YearRow {
    year: number;
    status: string;
    netProfit: number;
    canClose: boolean;
    canReopen: boolean;
    closingEntry: { id: string } | null;
  }

  let chart: Account[];
  const key = (k: string) => chart.find((a) => a.systemKey === k)!.id;
  /** حساب مصروف فرعي ليس من حسابات النظام (إيجار، كهرباء…) */
  const expenseAccount = () =>
    chart.find((a) => a.type === 'expense' && !a.isGroup && !a.systemKey)!.id;
  const balance = async (accountId: string, to = '2099-12-31') =>
    data<{ closing: number }>(
      await get(
        `/accounting/reports/ledger?accountId=${accountId}&from=2000-01-01&to=${to}`,
      ),
    ).closing;

  const activate = async () => {
    expect((await post('/accounting/activate', {})).status).toBe(201);
    chart = data<Account[]>(await get('/accounting/accounts'));
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

  it('posts an expense voucher with recoverable VAT at once, rejects bad accounts, and cancels by reversal', async () => {
    await activate();
    const rent = expenseAccount();
    const voucherBody = {
      date: TODAY,
      paidFromAccountId: key('cash'),
      payee: 'مؤجر المحل',
      payeeTaxNumber: '300000000000003',
      reference: 'INV-77',
      description: 'إيجار أكتوبر',
      lines: [{ accountId: rent, amount: 1000, taxRate: 15 }],
    };

    // حسابات مرفوضة: الدفع من حساب مصروف، والصرف على حساب له دفتر مساعد
    expect(
      (
        await post('/accounting/expenses', {
          ...voucherBody,
          paidFromAccountId: rent,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post('/accounting/expenses', {
          ...voucherBody,
          lines: [{ accountId: key('receivables'), amount: 10 }],
        })
      ).status,
    ).toBe(400);
    // صلاحية الإنشاء منفصلة عن العرض
    const viewer = tenant.tokenWith(['view_accounting']);
    expect(
      (await post('/accounting/expenses', voucherBody, viewer)).status,
    ).toBe(403);
    expect((await get('/accounting/expenses', viewer)).status).toBe(200);

    const created = await post('/accounting/expenses', voucherBody);
    expect(created.status).toBe(201);
    const voucher = data<Voucher>(created);
    expect(voucher).toMatchObject({
      number: 'PV-000001',
      status: 'posted',
      subtotal: 1000,
      taxTotal: 150,
      total: 1150,
      taxRecoverable: true,
    });
    expect(voucher.journalEntryId).toBeTruthy();
    expect(await balance(rent)).toBe(1000);
    expect(await balance(key('vat_input'))).toBe(150);
    expect(await balance(key('cash'))).toBe(-1150);
    // قيد السند لا يُعكس يدوياً: يُلغى السند
    expect(
      (
        await post(`/accounting/journals/${voucher.journalEntryId}/reverse`, {
          date: TODAY,
        })
      ).status,
    ).toBe(400);

    const list = data<{ total: number; data: Voucher[] }>(
      await get('/accounting/expenses?search=مؤجر'),
    );
    expect(list.total).toBe(1);

    const cancelled = await post(`/accounting/expenses/${voucher.id}/cancel`, {
      date: TODAY,
      reason: 'سُجّل مرتين',
    });
    expect(cancelled.status).toBe(200);
    expect(data<Voucher>(cancelled)).toMatchObject({ status: 'cancelled' });
    expect(data<Voucher>(cancelled).cancelJournalEntryId).toBeTruthy();
    expect(await balance(rent)).toBe(0);
    expect(await balance(key('vat_input'))).toBe(0);
    expect(await balance(key('cash'))).toBe(0);
    expect(
      (
        await post(`/accounting/expenses/${voucher.id}/cancel`, {
          date: TODAY,
          reason: 'مرة أخرى',
        })
      ).status,
    ).toBe(409);
  });

  it('builds the VAT return from documents and it reconciles with the VAT accounts', async () => {
    await activate();
    const units = data<{ id: string }[]>(await get('/catalog/units'));
    const productId = data<{ id: string }>(
      await post('/catalog/products', {
        name: 'مياه 330 مل',
        baseUnitId: units[0].id,
        salePrice: 23,
      }),
    ).id;
    const warehouseId = data<{ id: string; type: string }[]>(
      await get('/inventory/warehouses'),
    ).find((w) => w.type === 'main')!.id;
    const supplierId = data<{ id: string }>(
      await post('/purchasing/suppliers', { name: 'مؤسسة التوريد' }),
    ).id;

    const purchase = data<{ id: string }>(
      await post('/purchasing/invoices', {
        supplierId,
        warehouseId,
        invoiceDate: TODAY,
        lines: [{ productId, quantity: 100, unitPrice: 10 }],
      }),
    );
    const posted = await post(`/purchasing/invoices/${purchase.id}/post`);
    expect(posted.status).toBe(200);
    const purchaseTax = data<{ taxTotal: number }>(posted).taxTotal;

    const draft = data<{ id: string; total: number; lines: { id: string }[] }>(
      await post('/sales/invoices', {
        warehouseId,
        invoiceDate: TODAY,
        lines: [{ productId, quantity: 10, unitPrice: 23 }],
      }),
    );
    const issued = await post(`/sales/invoices/${draft.id}/issue`, {
      payments: [{ method: 'cash', amount: draft.total }],
    });
    expect(issued.status).toBe(200);
    const salesTax = data<{ taxTotal: number }>(issued).taxTotal;
    expect(salesTax).toBeGreaterThan(0);
    // إشعار دائن بنصف الكمية: تعديل سالب في نفس الفترة
    const ret = data<{ id: string; total: number }>(
      await post('/sales/returns', {
        invoiceId: draft.id,
        returnDate: TODAY,
        lines: [{ invoiceLineId: draft.lines[0].id, quantity: 5 }],
      }),
    );
    const retIssued = await post(`/sales/returns/${ret.id}/issue`, {
      refund: { method: 'cash', amount: ret.total },
    });
    expect(retIssued.status).toBe(200);
    const returnTax = data<{ taxTotal: number }>(retIssued).taxTotal;
    expect(returnTax).toBeGreaterThan(0);

    await post('/accounting/expenses', {
      date: TODAY,
      paidFromAccountId: key('cash'),
      payee: 'شركة الكهرباء',
      description: 'فاتورة كهرباء',
      lines: [{ accountId: expenseAccount(), amount: 200, taxRate: 15 }],
    });

    const res = await get(
      `/accounting/reports/vat-return?from=${TODAY}&to=${TODAY}`,
    );
    expect(res.status).toBe(200);
    const report = data<{
      sales: {
        rows: { key: string; tax: number }[];
        totals: { tax: number; adjustment: number };
      };
      purchases: { totals: { tax: number } };
      totals: { outputTax: number; inputTax: number; netVat: number };
      ledger: { outputTax: number; inputTax: number } | null;
    }>(res);
    expect(report.sales.rows.map((r) => r.key)).toEqual(
      expect.arrayContaining(['standard:15', 'zero', 'exempt']),
    );
    expect(report.sales.totals.adjustment).toBeLessThan(0);
    expect(report.totals.outputTax).toBeCloseTo(salesTax - returnTax, 3);
    expect(report.totals.inputTax).toBeCloseTo(purchaseTax + 30, 3);
    expect(report.totals.netVat).toBeCloseTo(
      salesTax - returnTax - purchaseTax - 30,
      3,
    );
    // الدفاتر تطابق المستندات
    expect(report.ledger).toEqual({
      outputTax: report.totals.outputTax,
      inputTax: report.totals.inputTax,
      netVat: report.totals.netVat,
    });

    // فترة مقلوبة أو أطول من سنة
    expect(
      (await get(`/accounting/reports/vat-return?from=${TODAY}&to=2000-01-01`))
        .status,
    ).toBe(400);
    expect(
      (
        await get(
          '/accounting/reports/vat-return?from=2020-01-01&to=2022-01-01',
        )
      ).status,
    ).toBe(400);
  });

  it('closes a finished year into retained earnings, locks it, and reopens it', async () => {
    await activate();
    // الدفاتر تبدأ من أول السنة الماضية
    await dataSource.query(
      `UPDATE accounting_settings SET "startDate" = $2 WHERE "tenantId" = $1`,
      [tenant.tenantId, `${LAST_YEAR}-01-01`],
    );
    const rent = expenseAccount();
    expect(
      (
        await post('/accounting/journals', {
          date: `${LAST_YEAR}-06-01`,
          description: 'مبيعات نقدية',
          lines: [
            { accountId: key('cash'), debit: 1000 },
            { accountId: key('sales'), credit: 1000 },
          ],
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post('/accounting/expenses', {
          date: `${LAST_YEAR}-07-01`,
          paidFromAccountId: key('cash'),
          payee: 'المؤجر',
          description: 'إيجار',
          lines: [{ accountId: rent, amount: 400 }],
        })
      ).status,
    ).toBe(201);

    const years = async () =>
      data<{ closedThroughYear: number | null; years: YearRow[] }>(
        await get('/accounting/year-end'),
      );
    const before = await years();
    const last = before.years.find((y) => y.year === LAST_YEAR)!;
    expect(last).toMatchObject({
      status: 'open',
      netProfit: 600,
      canClose: true,
      canReopen: false,
    });
    expect(before.years.find((y) => y.year === LAST_YEAR + 1)).toMatchObject({
      status: 'current',
      canClose: false,
    });
    // السنة الجارية لم تنتهِ
    expect(
      (await post(`/accounting/year-end/${LAST_YEAR + 1}/close`)).status,
    ).toBe(400);

    const closed = await post(`/accounting/year-end/${LAST_YEAR}/close`);
    expect(closed.status).toBe(200);
    expect(data<{ closedThroughYear: number }>(closed).closedThroughYear).toBe(
      LAST_YEAR,
    );
    expect((await post(`/accounting/year-end/${LAST_YEAR}/close`)).status).toBe(
      400,
    );

    const yearEnd = `${LAST_YEAR}-12-31`;
    // الإيرادات والمصروفات صفر بعد الإقفال، والربح في الأرباح المحتجزة
    expect(await balance(key('sales'), yearEnd)).toBe(0);
    expect(await balance(rent, yearEnd)).toBe(0);
    expect(await balance(key('retained_earnings'))).toBe(-600);
    // قائمة الدخل للسنة المقفلة تبقى بربحها
    const income = data<{ totals: { netProfit: number } }>(
      await get(
        `/accounting/reports/income-statement?from=${LAST_YEAR}-01-01&to=${yearEnd}`,
      ),
    );
    expect(income.totals.netProfit).toBe(600);
    // الميزانية متوازنة، والربح في حقوق الملكية لا في «سنوات سابقة غير مقفلة»
    const sheet = data<{
      earnings: { retained: number };
      totals: { balanced: boolean };
    }>(await get(`/accounting/reports/balance-sheet?asOf=${TODAY}`));
    expect(sheet.earnings.retained).toBe(0);
    expect(sheet.totals.balanced).toBe(true);

    // السنة المقفلة: لا قيد فيها، ولا يُفتح قفلها من الإعدادات
    expect(
      (
        await post('/accounting/journals', {
          date: `${LAST_YEAR}-12-15`,
          description: 'تسوية متأخرة',
          lines: [
            { accountId: key('cash'), debit: 5 },
            { accountId: key('sales'), credit: 5 },
          ],
        })
      ).status,
    ).toBe(400);
    expect(
      (await patch('/accounting/settings', { lockDate: null })).status,
    ).toBe(400);

    // إعادة الفتح: يُعكس قيد الإقفال
    const reopened = await post(`/accounting/year-end/${LAST_YEAR}/reopen`);
    expect(reopened.status).toBe(200);
    expect(
      data<{ closedThroughYear: number | null }>(reopened).closedThroughYear,
    ).toBeNull();
    expect(await balance(key('retained_earnings'))).toBe(0);
    expect(await balance(key('sales'), yearEnd)).toBe(-1000);
    expect(
      (await post(`/accounting/year-end/${LAST_YEAR}/reopen`)).status,
    ).toBe(400);

    // يُقفل ثانية بقيد جديد
    expect((await post(`/accounting/year-end/${LAST_YEAR}/close`)).status).toBe(
      200,
    );
    const after = await years();
    expect(after.years.find((y) => y.year === LAST_YEAR)).toMatchObject({
      status: 'closed',
      canReopen: true,
      netProfit: 600,
    });
    expect(await balance(key('retained_earnings'))).toBe(-600);
  });

  it('exports accounting reports to Excel — only with both plan features', async () => {
    await activate();
    const xlsx =
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const paths = [
      `/accounting/reports/trial-balance/export/excel?from=${TODAY}&to=${TODAY}`,
      `/accounting/reports/ledger/export/excel?accountId=${key('cash')}&from=${TODAY}&to=${TODAY}`,
      `/accounting/reports/income-statement/export/excel?from=${TODAY}&to=${TODAY}`,
      `/accounting/reports/balance-sheet/export/excel?asOf=${TODAY}`,
      `/accounting/reports/vat-return/export/excel?from=${TODAY}&to=${TODAY}`,
      `/accounting/journals/export/excel?from=${TODAY}`,
      `/accounting/expenses/export/excel`,
    ];
    for (const path of paths) {
      const res = await get(path);
      expect([path, res.status]).toEqual([path, 200]);
      expect(res.headers['content-type']).toContain(xlsx);
    }
    expect(
      (await get(`/accounting/reports/balance-sheet/export/csv?asOf=${TODAY}`))
        .status,
    ).toBe(400);

    // بلا تصدير التقارير، أو بلا المحاسبة
    const noExport = await createTenantFixture(dataSource, {
      features: ['accounting_module'],
    });
    expect(
      (
        await get(
          `/accounting/reports/balance-sheet/export/excel?asOf=${TODAY}`,
          noExport.adminToken,
        )
      ).status,
    ).toBe(403);
    const noAccounting = await createTenantFixture(dataSource, {
      features: ['reports_export'],
    });
    expect(
      (
        await get(
          `/accounting/reports/balance-sheet/export/excel?asOf=${TODAY}`,
          noAccounting.adminToken,
        )
      ).status,
    ).toBe(403);
  });
});
