import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { createTenantFixture, TenantFixture } from './utils/fixtures';
import { truncateAllTables } from './utils/test-database';

interface Named {
  id: string;
  name: string;
}
interface LotRow {
  id: string;
  lotNumber: string;
  expiryDate: string | null;
  quantity: number;
  status: string;
}
interface Order {
  id: string;
  number: string;
  status: string;
  plannedQuantity: number;
  producedQuantity: number;
  scrapQuantity: number;
  plannedMaterialCost: number;
  plannedLaborCost: number;
  plannedOverheadCost: number;
  materialCost: number;
  laborCost: number;
  overheadCost: number;
  receivedValue: number;
  varianceValue: number;
  unitCost: number;
  progress: number;
  materials: {
    productId: string;
    plannedQuantity: number;
    issuedQuantity: number;
    returnedQuantity: number;
    cost: number;
  }[];
  operations: {
    id: string;
    status: string;
    plannedSetupMinutes: number;
    plannedRunMinutes: number;
    actualRunMinutes: number;
  }[];
  byproducts: {
    productId: string;
    plannedQuantity: number;
    receivedQuantity: number;
  }[];
}

const day = (offset: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

/**
 * المصانع والدفعات عبر الـ HTTP: دفعات الشراء والصرف بالأقرب انتهاءً وتتبعها
 * لعميلها، ثم دورة أمر إنتاج كاملة بتكلفتها الفعلية وقيودها، والتخطيط.
 */
describe('Manufacturing and lots (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;
  let warehouseId: string;
  let unitId: string;

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${tenant.adminToken}` });
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
  const get = (path: string) => api().get(path).set(auth());
  const post = (path: string, body: object = {}) =>
    api().post(path).set(auth()).send(body);
  const ok = async <T>(res: request.Test | Promise<request.Response>) => {
    const response = await res;
    if (response.status >= 300) {
      throw new Error(`${response.status} ${JSON.stringify(response.body)}`);
    }
    return data<T>(response);
  };

  const product = (body: object) =>
    ok<Named>(
      post('/catalog/products', { baseUnitId: unitId, salePrice: 10, ...body }),
    );
  const lotsOf = async (productId: string, status = 'in_stock') =>
    (
      await ok<{ data: LotRow[] }>(
        get(`/inventory/lots?productId=${productId}&status=${status}`),
      )
    ).data;
  const stockOf = async (productId: string) =>
    (
      await ok<{ data: { productId: string; quantity: number }[] }>(
        get('/inventory/stock?limit=100'),
      )
    ).data.find((l) => l.productId === productId)?.quantity ?? 0;

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
    tenant = await createTenantFixture(dataSource, {
      features: [
        'products_module',
        'inventory_module',
        'purchasing_module',
        'sales_module',
        'manufacturing_module',
        'lot_tracking',
        'accounting_module',
      ],
    });
    unitId = (await ok<Named[]>(get('/catalog/units')))[0].id;
    warehouseId = (
      await ok<(Named & { type: string })[]>(get('/inventory/warehouses'))
    ).find((w) => w.type === 'main')!.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const purchase = async (
    supplierId: string,
    lines: object[],
  ): Promise<{ id: string; number: string }> => {
    const draft = await ok<{ id: string; number: string }>(
      post('/purchasing/invoices', {
        supplierId,
        warehouseId,
        invoiceDate: day(0),
        lines,
      }),
    );
    await ok(post(`/purchasing/invoices/${draft.id}/post`));
    return draft;
  };

  it('tracks lots from purchase to customer: FEFO, trace, returns, transfers, unassigned stock', async () => {
    const milk = await product({
      name: 'حليب',
      trackLots: true,
      shelfLifeDays: 10,
    });
    const supplier = await ok<Named>(
      post('/purchasing/suppliers', { name: 'مزرعة الألبان', leadTimeDays: 2 }),
    );
    await purchase(supplier.id, [
      {
        productId: milk.id,
        quantity: 10,
        unitPrice: 5,
        lotNumber: 'L-LATE',
        expiryDate: day(20),
      },
    ]);
    // بلا تاريخ: يُقترح من مدة الصلاحية (10 أيام)
    await purchase(supplier.id, [
      { productId: milk.id, quantity: 5, unitPrice: 5, lotNumber: 'L-SOON' },
    ]);
    let lots = await lotsOf(milk.id);
    expect(lots.map((l) => [l.lotNumber, l.quantity, l.expiryDate])).toEqual([
      ['L-SOON', 5, day(10)],
      ['L-LATE', 10, day(20)],
    ]);

    // البيع يصرف الأقرب انتهاءً أولاً
    const customer = await ok<Named>(
      post('/sales/customers', { name: 'بقالة النور' }),
    );
    const invoice = await ok<{ id: string }>(
      post('/sales/invoices', {
        warehouseId,
        customerId: customer.id,
        invoiceDate: day(0),
        lines: [{ productId: milk.id, quantity: 7, unitPrice: 8 }],
      }),
    );
    await ok(post(`/sales/invoices/${invoice.id}/issue`, { payments: [] }));
    lots = await lotsOf(milk.id);
    expect(lots.map((l) => [l.lotNumber, l.quantity])).toEqual([['L-LATE', 8]]);

    // التتبع: الدفعة من المورد إلى العميل
    const soon = (await lotsOf(milk.id, 'all')).find(
      (l) => l.lotNumber === 'L-SOON',
    )!;
    const trace = await ok<{
      movements: { type: string; quantity: number; partyName: string | null }[];
    }>(get(`/inventory/lots/${soon.id}`));
    expect(
      trace.movements.map((m) => [m.type, m.quantity, m.partyName]),
    ).toEqual([
      ['purchase', 5, 'مزرعة الألبان'],
      ['sale', -5, 'بقالة النور'],
    ]);

    // المرتجع يعود لدفعات البيع: لا رصيد بلا دفعة
    const invoiceLines = await ok<{ lines: { id: string }[] }>(
      get(`/sales/invoices/${invoice.id}`),
    );
    const ret = await ok<{ id: string }>(
      post('/sales/returns', {
        invoiceId: invoice.id,
        returnDate: day(0),
        lines: [{ invoiceLineId: invoiceLines.lines[0].id, quantity: 3 }],
      }),
    );
    await ok(post(`/sales/returns/${ret.id}/issue`, {}));
    expect(await stockOf(milk.id)).toBe(11);
    expect(await ok<unknown[]>(get('/inventory/lots/unassigned'))).toEqual([]);
    expect(
      (await lotsOf(milk.id)).reduce((sum, l) => sum + l.quantity, 0),
    ).toBe(11);

    // التحويل ينقل الدفعات نفسها للمخزن الآخر
    const main = (
      await ok<{ id: string; branchId: string }[]>(get('/inventory/warehouses'))
    ).find((w) => w.id === warehouseId)!;
    const branchWarehouse = await ok<Named>(
      post('/inventory/warehouses', {
        name: 'مخزن الفرع',
        branchId: main.branchId,
      }),
    );
    const transfer = await ok<{ id: string }>(
      post('/inventory/transfers', {
        fromWarehouseId: warehouseId,
        toWarehouseId: branchWarehouse.id,
        lines: [{ productId: milk.id, quantity: 4 }],
      }),
    );
    await ok(post(`/inventory/transfers/${transfer.id}/send`));
    await ok(post(`/inventory/transfers/${transfer.id}/receive`, {}));
    const atBranch = (
      await ok<{ data: LotRow[] }>(
        get(
          `/inventory/lots?productId=${milk.id}&warehouseId=${branchWarehouse.id}`,
        ),
      )
    ).data;
    expect(atBranch.reduce((sum, l) => sum + l.quantity, 0)).toBe(4);

    // القاربة على الانتهاء خلال 30 يوماً
    const summary = await ok<{ expiring: number; lotsInStock: number }>(
      get('/inventory/lots/summary'),
    );
    expect(summary.expiring).toBe(summary.lotsInStock);

    // رصيد قبل التتبع: غير معيّن، ثم يُعيَّن لدفعة
    await ok(
      post('/inventory/adjustments', {
        warehouseId,
        type: 'opening',
        lines: [{ productId: milk.id, quantity: 4, unitCost: 5 }],
      }),
    );
    expect(
      await ok<{ unassigned: number }[]>(get('/inventory/lots/unassigned')),
    ).toMatchObject([{ unassigned: 4 }]);
    await ok(
      post('/inventory/lots/assign', {
        warehouseId,
        productId: milk.id,
        quantity: 4,
        lotNumber: 'OLD-STOCK',
        expiryDate: day(3),
      }),
    );
    expect(await ok<unknown[]>(get('/inventory/lots/unassigned'))).toEqual([]);
    await post('/inventory/lots/assign', {
      warehouseId,
      productId: milk.id,
      quantity: 1,
      lotNumber: 'X',
    }).expect(400);
  });

  it('runs a production order end to end with actual costing, lots, accounting and planning', async () => {
    await ok(post('/accounting/activate', {}));
    const flour = await product({ name: 'دقيق', trackLots: true });
    const sugar = await product({ name: 'سكر' });
    const cake = await product({
      name: 'كيكة',
      trackLots: true,
      shelfLifeDays: 7,
      procurement: 'make',
    });
    const crumbs = await product({ name: 'فتات' });
    const supplier = await ok<Named>(
      post('/purchasing/suppliers', { name: 'مطاحن الشرق', leadTimeDays: 3 }),
    );
    await purchase(supplier.id, [
      {
        productId: flour.id,
        quantity: 100,
        unitPrice: 2,
        lotNumber: 'F1',
        expiryDate: day(60),
      },
      { productId: sugar.id, quantity: 50, unitPrice: 4 },
    ]);

    const oven = await ok<Named>(
      post('/manufacturing/work-centers', {
        name: 'فرن 1',
        costPerHour: 60,
        overheadPerHour: 30,
        workingDays: [0, 1, 2, 3, 4, 5, 6],
      }),
    );
    const bom = await ok<{ id: string; isDefault: boolean }>(
      post('/manufacturing/boms', {
        kind: 'production',
        productId: cake.id,
        outputQuantity: 10,
        lines: [
          { componentId: flour.id, quantity: 5 },
          { componentId: sugar.id, quantity: 2 },
        ],
        operations: [
          {
            sequence: 10,
            name: 'خَبز',
            workCenterId: oven.id,
            setupMinutes: 15,
            runMinutes: 45,
          },
        ],
        byproducts: [{ productId: crumbs.id, quantity: 1 }],
      }),
    );
    expect(bom.isDefault).toBe(true);
    // الخامات 18 + وقت ساعة × (60 + 30) = 108 للعشرة
    expect(
      await ok<{ totalCost: number; unitCost: number }>(
        get(`/manufacturing/boms/${bom.id}/cost`),
      ),
    ).toMatchObject({ totalCost: 108, unitCost: 10.8 });
    // دائرة: الكيكة لا تكون مكوّناً لدقيقها
    await post('/manufacturing/boms', {
      kind: 'production',
      productId: flour.id,
      lines: [{ componentId: cake.id, quantity: 1 }],
    }).expect(400);

    let order = await ok<Order>(
      post('/manufacturing/orders', {
        productId: cake.id,
        plannedQuantity: 20,
        warehouseId,
        plannedStartDate: day(0),
        plannedEndDate: day(1),
      }),
    );
    expect(order.materials.map((m) => m.plannedQuantity).sort()).toEqual(
      [10, 4].sort(),
    );
    order = await ok<Order>(post(`/manufacturing/orders/${order.id}/release`));
    expect(order).toMatchObject({
      status: 'released',
      plannedMaterialCost: 36,
      plannedLaborCost: 105,
      plannedOverheadCost: 52.5,
    });
    await post(`/manufacturing/orders/${order.id}`, {}).expect(404);

    // صرف كل الخامات (الدقيق من دفعته)، ثم صرف زائد وردّه
    order = await ok<Order>(
      post(`/manufacturing/orders/${order.id}/issue`, {}),
    );
    expect(order.status).toBe('in_progress');
    expect(order.materialCost).toBe(36);
    order = await ok<Order>(
      post(`/manufacturing/orders/${order.id}/issue`, {
        lines: [{ productId: flour.id, quantity: 1 }],
      }),
    );
    order = await ok<Order>(
      post(`/manufacturing/orders/${order.id}/return`, {
        lines: [{ productId: flour.id, quantity: 1 }],
      }),
    );
    expect(order.materialCost).toBe(36);
    expect((await lotsOf(flour.id))[0]).toMatchObject({
      lotNumber: 'F1',
      quantity: 90,
    });

    // الوقت: تجهيز 15 وتشغيل 90 دقيقة، وتوقف بسببه (لا يُحمَّل على المنتج)
    const operationId = order.operations[0].id;
    for (const log of [
      { kind: 'setup', minutes: 15 },
      {
        kind: 'run',
        minutes: 90,
        quantity: 19,
        scrapQuantity: 1,
        scrapReason: 'defect',
      },
      { kind: 'downtime', minutes: 20, downtimeReason: 'breakdown' },
    ]) {
      await ok(
        post(`/manufacturing/orders/${order.id}/time/manual`, {
          operationId,
          ...log,
        }),
      );
    }
    await post(`/manufacturing/orders/${order.id}/time/start`, {
      operationId,
      kind: 'downtime',
    }).expect(400);

    // استلام جزئي بالتكلفة المخططة: 8 × (193.5 ÷ 20)
    order = await ok<Order>(
      post(`/manufacturing/orders/${order.id}/output`, { quantity: 8 }),
    );
    expect(order.receivedValue).toBe(77.4);

    // الاستلام الأخير يحمل باقي التكلفة الفعلية كلها
    order = await ok<Order>(
      post(`/manufacturing/orders/${order.id}/output`, {
        quantity: 11,
        scrapQuantity: 1,
        scrapReason: 'defect',
        final: true,
      }),
    );
    expect(order).toMatchObject({
      status: 'completed',
      producedQuantity: 19,
      scrapQuantity: 1,
      laborCost: 105,
      overheadCost: 52.5,
      receivedValue: 193.5,
      varianceValue: 0,
      unitCost: 10.1842,
      progress: 95,
    });
    expect(order.byproducts[0].receivedQuantity).toBe(1.9);
    const cakeLots = await lotsOf(cake.id);
    expect(cakeLots).toMatchObject([
      { lotNumber: order.number, quantity: 19, expiryDate: day(7) },
    ]);
    await post(`/manufacturing/orders/${order.id}/issue`, {}).expect(400);

    // المحاسبة: الإنتاج تحت التشغيل يُقفل صفراً، والوقت المحمّل بقيمته
    await ok(post('/accounting/sync'));
    const accounts = await ok<{ id: string; systemKey: string | null }[]>(
      get('/accounting/accounts'),
    );
    const closing = async (key: string) =>
      (
        await ok<{ closing: number }>(
          get(
            `/accounting/reports/ledger?accountId=${accounts.find((a) => a.systemKey === key)!.id}&from=2000-01-01&to=2099-12-31`,
          ),
        )
      ).closing;
    expect(await closing('work_in_progress')).toBe(0);
    expect(await closing('production_absorbed')).toBe(-157.5);

    // التخطيط: أمر كبير ينقصه دقيق يُشترى من آخر مورد بمدة توريده
    await ok(
      post('/manufacturing/orders', {
        productId: cake.id,
        plannedQuantity: 400,
        warehouseId,
        plannedStartDate: day(10),
      }),
    );
    const mrp = await ok<
      {
        productId: string;
        shortage: number;
        action: string;
        supplierId: string;
        orderBy: string;
      }[]
    >(get('/manufacturing/planning/mrp'));
    const flourRow = mrp.find((r) => r.productId === flour.id)!;
    expect(flourRow).toMatchObject({
      shortage: 110,
      action: 'buy',
      supplierId: supplier.id,
      orderBy: day(7),
    });
    const drafts = await ok<{ id: string }[]>(
      post('/manufacturing/planning/mrp/purchase-drafts', {
        warehouseId,
        lines: [
          { productId: flour.id, quantity: 110, supplierId: supplier.id },
        ],
      }),
    );
    expect(
      await ok<{ status: string; orderDate: string }>(
        get(`/purchasing/invoices/${drafts[0].id}`),
      ),
    ).toMatchObject({ status: 'draft', orderDate: day(0) });

    const capacity = await ok<{ workCenterId: string; load: number }[]>(
      get(`/manufacturing/planning/capacity?from=${day(0)}&to=${day(14)}`),
    );
    expect(capacity[0].load).toBeGreaterThan(0);

    const performance = await ok<{
      products: { producedQuantity: number; scrapQuantity: number }[];
      downtime: { reason: string; minutes: number }[];
    }>(get(`/manufacturing/planning/performance?from=${day(-1)}&to=${day(1)}`));
    expect(performance.products[0]).toMatchObject({
      producedQuantity: 19,
      scrapQuantity: 1,
    });
    expect(performance.downtime[0]).toMatchObject({
      reason: 'breakdown',
      minutes: 20,
    });
  });
});
