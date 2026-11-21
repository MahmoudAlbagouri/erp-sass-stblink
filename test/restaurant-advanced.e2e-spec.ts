import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
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

const day = (offset = 0) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

/**
 * المطعم المتقدم: وصفة تُخصم مكوّناتها عند البيع، إضافات تغيّر السعر والمخزون
 * (جبنة زيادة، بدون بصل، مشروب الوجبة)، محطات مطبخ تجهّز نصيبها، سياق الطاولة
 * على الفاتورة، هالك طبق، حجوزات، وتقارير المنيو والاستهلاك والخدمة.
 */
describe('Restaurant advanced (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${tenant.adminToken}` });
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
  const get = (path: string) => api().get(path).set(auth());
  const post = (path: string, body: object = {}) =>
    api().post(path).set(auth()).send(body);
  const patch = (path: string, body: object) =>
    api().patch(path).set(auth()).send(body);
  const ok = async <T>(res: request.Test | Promise<request.Response>) => {
    const response = await res;
    if (response.status >= 300) {
      throw new Error(`${response.status} ${JSON.stringify(response.body)}`);
    }
    return data<T>(response);
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
    tenant = await createTenantFixture(dataSource, {
      features: [
        'products_module',
        'inventory_module',
        'sales_module',
        'pos_module',
        'restaurant_module',
      ],
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sells a burger meal: recipe, modifiers, stations, table context, waste, reports', async () => {
    const unitId = (await ok<Named[]>(get('/catalog/units')))[0].id;
    const warehouseId = (
      await ok<(Named & { type: string })[]>(get('/inventory/warehouses'))
    ).find((w) => w.type === 'main')!.id;
    const grillCategory = await ok<Named>(
      post('/catalog/categories', { name: 'برجر' }),
    );
    const product = (body: object) =>
      ok<Named>(
        post('/catalog/products', {
          baseUnitId: unitId,
          salePrice: 5,
          ...body,
        }),
      );
    const bun = await product({ name: 'خبز برجر' });
    const patty = await product({ name: 'قطعة لحم' });
    const cheese = await product({ name: 'شريحة جبن' });
    const onion = await product({ name: 'بصل' });
    const cola = await product({ name: 'كولا' });
    const burger = await product({
      name: 'برجر كلاسيك',
      type: 'composite',
      salePrice: 25,
      categoryId: grillCategory.id,
    });
    await ok(
      post('/inventory/adjustments', {
        warehouseId,
        type: 'opening',
        lines: [
          { productId: bun.id, quantity: 50, unitCost: 1 },
          { productId: patty.id, quantity: 50, unitCost: 5 },
          { productId: cheese.id, quantity: 50, unitCost: 2 },
          { productId: onion.id, quantity: 50, unitCost: 0.5 },
          { productId: cola.id, quantity: 50, unitCost: 1.5 },
        ],
      }),
    );

    // الوصفة وتكلفتها: 1 + 5 + 0.1 × 0.5 = 6.05، ونسبتها من السعر قبل الضريبة
    const recipe = await ok<{ id: string }>(
      post('/manufacturing/boms', {
        kind: 'recipe',
        productId: burger.id,
        prepMinutes: 8,
        lines: [
          { componentId: bun.id, quantity: 1 },
          { componentId: patty.id, quantity: 1 },
          { componentId: onion.id, quantity: 0.1 },
        ],
      }),
    );
    expect(
      await ok<{ unitCost: number; costPercent: number }>(
        get(`/manufacturing/boms/${recipe.id}/cost`),
      ),
    ).toMatchObject({ unitCost: 6.05, costPercent: 27.83 });
    // الوصفة لصنف مركّب فقط
    await post('/manufacturing/boms', {
      kind: 'recipe',
      productId: cola.id,
      lines: [{ componentId: bun.id, quantity: 1 }],
    }).expect(400);

    // الإضافات: جبنة زيادة (+3 وتخرج شريحة)، بدون بصل، ومشروب الوجبة (إلزامي)
    const extras = await ok<{ id: string; options: Named[] }>(
      post('/restaurant/modifier-groups', {
        name: 'إضافات',
        minSelect: 0,
        maxSelect: 3,
        options: [
          { name: 'جبنة زيادة', priceDelta: 3, productId: cheese.id },
          { name: 'بدون بصل', removesProductId: onion.id },
        ],
      }),
    );
    const drink = await ok<{ id: string; options: Named[] }>(
      post('/restaurant/modifier-groups', {
        name: 'مشروب الوجبة',
        minSelect: 1,
        maxSelect: 1,
        options: [{ name: 'كولا', productId: cola.id, isDefault: true }],
      }),
    );
    const option = (group: { options: Named[] }, name: string) =>
      group.options.find((o) => o.name === name)!;
    await ok(
      post(`/restaurant/products/${burger.id}/modifier-groups`, {
        groupIds: [extras.id, drink.id],
      }),
    );

    // محطتان: الشواية لتصنيف البرجر، والمشروبات تستلم الباقي
    const grill = await ok<Named>(
      post('/restaurant/stations', {
        name: 'الشواية',
        categoryIds: [grillCategory.id],
      }),
    );
    const bar = await ok<Named>(
      post('/restaurant/stations', { name: 'المشروبات' }),
    );

    // ─── الجهاز والوردية ───
    const table = await ok<Named>(
      post('/pos/restaurant/tables', { name: 'T1', seats: 4 }),
    );
    const deviceId = (
      await ok<Named>(
        post('/pos/devices', { name: 'كاشير', code: 'POS1', warehouseId }),
      )
    ).id;
    const installationId = randomUUID();
    const deviceKey = (
      await ok<{ deviceKey: string }>(
        post(`/pos/devices/${deviceId}/bind`, { installationId }),
      )
    ).deviceKey;
    const asDevice = {
      'x-pos-device': deviceId,
      'x-pos-key': deviceKey,
      'x-pos-installation': installationId,
    };
    const sync = async (...operations: object[]) =>
      data<{ results: { status: string; message?: string }[] }>(
        await api().post('/pos/device/sync').set(asDevice).send({ operations }),
      ).results;
    const bootstrap = data<{
      restaurant: {
        modifierGroups: { id: string; options: Named[] }[];
        productModifierGroups: Record<string, string[]>;
      };
    }>(await api().get('/pos/device/bootstrap').set(asDevice));
    expect(bootstrap.restaurant.productModifierGroups[burger.id]).toEqual([
      extras.id,
      drink.id,
    ]);
    expect(bootstrap.restaurant.modifierGroups).toHaveLength(2);

    const shiftId = randomUUID();
    expect(
      await sync({
        id: 'open',
        type: 'shift.open',
        payload: {
          id: shiftId,
          openedAt: new Date().toISOString(),
          openingCash: 0,
        },
      }),
    ).toMatchObject([{ status: 'ok' }]);

    // ─── المطبخ: كل سطر لمحطته، والبون جاهز حين تجهز كلتاهما ───
    const ticketId = randomUUID();
    const orderRef = randomUUID();
    expect(
      await sync({
        id: 'kitchen-1',
        type: 'kitchen.send',
        payload: {
          id: ticketId,
          ticketNo: 1,
          shiftId,
          orderType: 'dine_in',
          tableId: table.id,
          tableName: 'T1',
          orderRef,
          round: 1,
          sentAt: new Date().toISOString(),
          lines: [
            {
              productId: burger.id,
              name: 'برجر كلاسيك',
              quantity: 2,
              modifiers: ['جبنة زيادة', 'بدون بصل'],
            },
            { productId: cola.id, name: 'كولا', quantity: 2 },
          ],
        },
      }),
    ).toMatchObject([{ status: 'ok' }]);
    const grillBoard = await ok<
      { id: string; lines: { name: string; modifiers?: string[] }[] }[]
    >(get(`/pos/kitchen/orders?stationId=${grill.id}`));
    expect(grillBoard[0].lines).toEqual([
      expect.objectContaining({
        name: 'برجر كلاسيك',
        modifiers: ['جبنة زيادة', 'بدون بصل'],
      }),
    ]);
    expect(
      (
        await ok<{ status: string }>(
          patch(`/pos/kitchen/orders/${ticketId}/stations/${grill.id}`, {
            status: 'ready',
          }),
        )
      ).status,
    ).toBe('preparing');
    expect(
      (
        await ok<{ status: string }>(
          patch(`/pos/kitchen/orders/${ticketId}/stations/${bar.id}`, {
            status: 'ready',
          }),
        )
      ).status,
    ).toBe('ready');

    // ─── البيع: 2 برجر بـ 28 (25 + 3 جبنة) شامل الضريبة ───
    const saleUuid = randomUUID();
    expect(
      await sync({
        id: 'sale-1',
        type: 'sale',
        payload: {
          uuid: saleUuid,
          number: 'POS1-000001',
          issuedAt: new Date().toISOString(),
          shiftId,
          pricesIncludeTax: true,
          lines: [
            {
              productId: burger.id,
              quantity: 2,
              unitPrice: 28,
              discount: 0,
              taxRate: 15,
              subtotal: 48.7,
              taxAmount: 7.3,
              total: 56,
              modifiers: [
                {
                  optionId: option(extras, 'جبنة زيادة').id,
                  name: 'جبنة زيادة',
                  priceDelta: 3,
                },
                {
                  optionId: option(extras, 'بدون بصل').id,
                  name: 'بدون بصل',
                  priceDelta: 0,
                },
                {
                  optionId: option(drink, 'كولا').id,
                  name: 'كولا',
                  priceDelta: 0,
                },
              ],
            },
          ],
          payments: [{ method: 'cash', amount: 56 }],
          order: {
            orderType: 'dine_in',
            tableId: table.id,
            tableName: 'T1',
            guestCount: 2,
            openedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
          },
        },
      }),
    ).toMatchObject([{ status: 'ok' }]);

    const stock = async () =>
      Object.fromEntries(
        (
          await ok<{ data: { productId: string; quantity: number }[] }>(
            get('/inventory/stock?limit=100'),
          )
        ).data.map((l) => [l.productId, l.quantity]),
      );
    let levels = await stock();
    // خبز ولحم ×2، جبنة ×2، كولا ×2، والبصل لم يُخصم ("بدون بصل")
    expect([
      levels[bun.id],
      levels[patty.id],
      levels[cheese.id],
      levels[cola.id],
      levels[onion.id],
    ]).toEqual([48, 48, 48, 48, 50]);

    const [invoice] = await dataSource.query<
      {
        costTotal: string;
        orderType: string;
        guestCount: number;
        unitCost: string;
        modifiers: unknown[];
      }[]
    >(
      `SELECT i."costTotal", i."orderType", i."guestCount", l."unitCost", l."modifiers"
         FROM sales_invoices i JOIN sales_invoice_lines l ON l."invoiceId" = i.id
        WHERE i.uuid = $1`,
      [saleUuid],
    );
    // 1 + 5 + 2 + 1.5 = 9.5 للبرجر الواحد
    expect(invoice).toMatchObject({
      costTotal: '19.000',
      orderType: 'dine_in',
      guestCount: 2,
      unitCost: '9.5000',
    });
    expect(invoice.modifiers).toHaveLength(3);
    // سعر الإضافات محسوب: لا مخالفة "سعر غير سعر الصنف"
    const anomalies = await dataSource.query<{ details: string }[]>(
      `SELECT "details" FROM pos_audit_logs WHERE "action" = 'sale_anomaly'`,
    );
    expect(anomalies).toEqual([]);

    // ─── هالك طبق: تخرج مكوّنات وصفته كتسوية "هالك" ───
    await ok(
      post('/restaurant/waste', {
        warehouseId,
        productId: burger.id,
        quantity: 1,
      }),
    );
    levels = await stock();
    expect([levels[bun.id], levels[patty.id], levels[onion.id]]).toEqual([
      47, 47, 49.9,
    ]);

    // ─── الحجوزات ───
    const at = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const reservation = await ok<{ id: string; number: string }>(
      post('/restaurant/reservations', {
        customerName: 'أ. خالد',
        guestCount: 4,
        reservedAt: at,
        tableId: table.id,
      }),
    );
    await post('/restaurant/reservations', {
      customerName: 'غيره',
      guestCount: 2,
      reservedAt: at,
      tableId: table.id,
    }).expect(400);
    await ok(
      post(`/restaurant/reservations/${reservation.id}/status`, {
        status: 'seated',
      }),
    );
    expect(
      await ok<{ status: string }>(
        post(`/restaurant/reservations/${reservation.id}/status`, {
          status: 'completed',
        }),
      ),
    ).toMatchObject({ status: 'completed' });

    // ─── التقارير ───
    const range = `from=${day(-1)}&to=${day(1)}`;
    const menu = await ok<{
      items: {
        productId: string;
        quantity: number;
        cost: number;
        class: string;
      }[];
    }>(get(`/restaurant/reports/menu-engineering?${range}`));
    expect(menu.items.find((i) => i.productId === burger.id)).toMatchObject({
      quantity: 2,
      cost: 19,
    });
    const consumption = await ok<
      { productId: string; recipeUsage: number; waste: number }[]
    >(get(`/restaurant/reports/consumption?${range}`));
    expect(consumption.find((r) => r.productId === patty.id)).toMatchObject({
      recipeUsage: 2,
      waste: 1,
    });
    const service = await ok<{
      covers: number;
      averageTableMinutes: number;
      stations: { name: string; tickets: number }[];
      reservations: { honored: number };
    }>(get(`/restaurant/reports/service?${range}`));
    expect(service.covers).toBe(2);
    expect(service.averageTableMinutes).toBeGreaterThanOrEqual(29);
    expect(service.stations.map((s) => s.name).sort()).toEqual([
      'الشواية',
      'المشروبات',
    ]);
    expect(service.reservations.honored).toBe(1);

    // ─── صنف مخزني بإضافة تستهلك مخزوناً ثم يُرجَع ───
    // تكلفة السطر = كولا 1.5 + جبنة 2 = 3.5 (للهامش)، لكن الكولا وحدها تعود
    // للمخزن بتكلفتها 1.5: متوسط تكلفتها لا يتشوّه بتكلفة الإضافة
    expect(
      await sync({
        id: 'sale-2',
        type: 'sale',
        payload: {
          uuid: randomUUID(),
          number: 'POS1-000002',
          issuedAt: new Date().toISOString(),
          shiftId,
          pricesIncludeTax: true,
          lines: [
            {
              productId: cola.id,
              quantity: 1,
              unitPrice: 8,
              discount: 0,
              taxRate: 15,
              subtotal: 6.96,
              taxAmount: 1.04,
              total: 8,
              modifiers: [
                {
                  optionId: option(extras, 'جبنة زيادة').id,
                  name: 'جبنة زيادة',
                  priceDelta: 3,
                },
              ],
            },
          ],
          payments: [{ method: 'cash', amount: 8 }],
        },
      }),
    ).toMatchObject([{ status: 'ok' }]);
    expect(
      await sync({
        id: 'return-2',
        type: 'return',
        payload: {
          uuid: randomUUID(),
          invoiceNumber: 'POS1-000002',
          issuedAt: new Date().toISOString(),
          shiftId,
          lines: [{ lineIndex: 0, quantity: 1 }],
          refundMethod: 'cash',
          refundAmount: 8,
        },
      }),
    ).toMatchObject([{ status: 'ok' }]);
    const [colaLine] = await dataSource.query<{ unitCost: string }[]>(
      `SELECT l."unitCost" FROM sales_invoice_lines l
         JOIN sales_invoices i ON i.id = l."invoiceId"
        WHERE i.number = 'POS1-000002'`,
    );
    expect(Number(colaLine.unitCost)).toBe(3.5);
    const [restocked] = await dataSource.query<{ unitCost: string }[]>(
      `SELECT "unitCost" FROM stock_movements
        WHERE "productId" = $1 AND "type" = 'sale_return'`,
      [cola.id],
    );
    expect(Number(restocked.unitCost)).toBe(1.5);
  });
});
