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
interface Unit extends Named {
  code: string | null;
  depth: number;
  path: string;
  parentId: string | null;
}
interface Plant {
  id: string;
  tag: string;
  position: number;
  status: string;
  unitId: string;
}
interface Operation {
  id: string;
  number: string;
  status: string;
  inputCost: number;
  laborCost: number;
  laborHours: number | null;
  plantsCovered: number | null;
  harvestAllowedAt: string | null;
  waterM3: number | null;
  plants: { id: string }[];
}
interface Harvest {
  id: string;
  number: string;
  quantity: number;
  unitCost: number;
  value: number;
  valuation: string;
  lotNumber: string;
  phiViolation: boolean;
  status: string;
}

/**
 * المزارع عبر الـ HTTP: شجرة المزرعة وحدودها، محاصيل وأصناف وتقويم، سجل
 * النخيل نخلة نخلة، عمليات بمدخلاتها وتكلفتها وفترة أمان المبيد، حصاد بدفعة
 * وقيمته، الآفات، التقارير، القيود، والشاشة الميدانية بلا إنترنت.
 */
describe('Farms (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tenant: TenantFixture;
  let unitId: string;
  let warehouseId: string;

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${tenant.adminToken}` });
  const data = <T>(res: request.Response): T => (res.body as { data: T }).data;
  const get = (path: string) => api().get(path).set(auth());
  const post = (path: string, body: object = {}) =>
    api().post(path).set(auth()).send(body);
  const patch = (path: string, body: object) =>
    api().patch(path).set(auth()).send(body);
  const del = (path: string) => api().delete(path).set(auth());
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
        'farms_module',
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

  it('runs a palm season and a wheat cycle end to end', async () => {
    await ok(post('/accounting/activate', {}));
    const fertilizer = await product({ name: 'سماد NPK' });
    const pesticide = await product({ name: 'مبيد سوسة' });
    const dates = await product({
      name: 'تمر سكري',
      trackLots: true,
      shelfLifeDays: 365,
    });
    const wheatGrain = await product({ name: 'قمح' });
    await ok(
      post('/inventory/adjustments', {
        warehouseId,
        type: 'opening',
        lines: [
          { productId: fertilizer.id, quantity: 100, unitCost: 3 },
          { productId: pesticide.id, quantity: 10, unitCost: 50 },
        ],
      }),
    );

    // ─── المزرعة وحدودها: المساحة من المضلع (~100م × 100م) ───
    const farm = await ok<Named & { code: string; areaM2: number }>(
      post('/farms', {
        name: 'مزرعة القصيم',
        warehouseId,
        laborHourCost: 10,
        boundary: [
          [46.7, 24.7],
          [46.700987, 24.7],
          [46.700987, 24.7009],
          [46.7, 24.7009],
          [46.7, 24.7],
        ],
      }),
    );
    expect(farm.code).toBe('FRM-000001');
    expect(farm.areaM2).toBeGreaterThan(9500);
    expect(farm.areaM2).toBeLessThan(10500);
    await post('/farms', {
      name: 'مزرعة القصيم',
      boundary: [[1, 2]],
    }).expect(400);

    // ─── الشجرة: قطاع ← حوش ← 3 صفوف، وحقل في قطاع آخر ───
    const sector = await ok<Unit>(
      post(`/farms/${farm.id}/units`, {
        kind: 'sector',
        name: 'القطاع الشمالي',
        code: 'A',
        irrigationIntervalDays: 3,
      }),
    );
    const block = await ok<Unit>(
      post(`/farms/${farm.id}/units`, {
        parentId: sector.id,
        kind: 'block',
        name: 'حوش 1',
        code: 'B1',
      }),
    );
    const rows = await ok<Unit[]>(
      post(`/farms/${farm.id}/units/bulk`, {
        parentId: block.id,
        kind: 'row',
        count: 3,
        namePrefix: 'صف',
        codePrefix: 'R',
        plannedPositions: 10,
      }),
    );
    expect(rows.map((r) => [r.name, r.code, r.depth])).toEqual([
      ['صف 1', 'R1', 3],
      ['صف 2', 'R2', 3],
      ['صف 3', 'R3', 3],
    ]);
    const [r1, r2, r3] = rows;
    const fieldSector = await ok<Unit>(
      post(`/farms/${farm.id}/units`, { kind: 'sector', name: 'قطاع الحقول' }),
    );
    const field = await ok<Unit>(
      post(`/farms/${farm.id}/units`, {
        parentId: fieldSector.id,
        kind: 'field',
        name: 'حقل 1',
        areaM2: 10000,
      }),
    );

    // النقل: قطاع تجريبي بصفّه ينتقل تحت القطاع الشمالي (المسار والعمق)
    const spare = await ok<Unit>(
      post(`/farms/${farm.id}/units`, { kind: 'sector', name: 'تجريبي' }),
    );
    const spareRow = await ok<Unit>(
      post(`/farms/${farm.id}/units`, {
        parentId: spare.id,
        kind: 'row',
        name: 'صف تجريبي',
      }),
    );
    await ok(
      patch(`/farms/${farm.id}/units/${spare.id}`, { parentId: sector.id }),
    );
    const tree = await ok<Unit[]>(get(`/farms/${farm.id}/units`));
    expect(tree.find((u) => u.id === spareRow.id)).toMatchObject({
      depth: 3,
      path: `${sector.id}/${spare.id}/${spareRow.id}`,
    });
    await patch(`/farms/${farm.id}/units/${sector.id}`, {
      parentId: spare.id,
    }).expect(400);
    await del(`/farms/${farm.id}/units/${spare.id}`).expect(409);
    await del(`/farms/${farm.id}/units/${spareRow.id}`).expect(204);
    await del(`/farms/${farm.id}/units/${spare.id}`).expect(204);

    // ─── المحاصيل: نخيل (نخلة نخلة) وقمح (بالمساحة) بتقويمه ───
    const palm = await ok<
      Named & { lifecycle: string; defaultTrackingMode: string }
    >(post('/farm-crops', { name: 'نخيل', category: 'palm' }));
    expect(palm).toMatchObject({
      lifecycle: 'perennial',
      defaultTrackingMode: 'individual',
    });
    const sukkari = await ok<Named>(
      post(`/farm-crops/${palm.id}/varieties`, {
        name: 'سكري',
        harvestProductId: dates.id,
        standardCost: 4,
        expectedYieldPerPlant: 50,
      }),
    );
    const wheat = await ok<Named>(
      post('/farm-crops', {
        name: 'قمح',
        category: 'field_crop',
        harvestProductId: wheatGrain.id,
      }),
    );
    const wheatVariety = await ok<Named>(
      post(`/farm-crops/${wheat.id}/varieties`, {
        name: 'قمح محلي',
        daysToHarvest: 150,
        expectedYieldPerHectare: 5000,
      }),
    );
    await ok(
      post(`/farm-crops/${wheat.id}/calendar`, {
        operationType: 'irrigation',
        title: 'ري أسبوعي',
        anchor: 'planting',
        dayOffset: 0,
        repeatEveryDays: 7,
        repeatCount: 3,
      }),
    );
    await post(`/farm-crops/${wheat.id}/calendar`, {
      operationType: 'pollination',
      title: 'بلا موعد',
      anchor: 'yearly',
    }).expect(400);
    // منتج الحصاد صنف مخزني
    const service = await product({ name: 'خدمة', type: 'service' });
    await post(`/farm-crops/${palm.id}/varieties`, {
      name: 'خطأ',
      harvestProductId: service.id,
    }).expect(400);

    // ─── زراعة النخيل وسجلها: 5 في الصف الأول و5 في الثاني ───
    const palmPlanting = await ok<{
      id: string;
      number: string;
      plantCount: number;
    }>(
      post('/plantings', {
        unitId: block.id,
        cropId: palm.id,
        varietyId: sukkari.id,
        plantedAt: '2015-01-01',
        plantedAtPrecision: 'year',
      }),
    );
    expect(palmPlanting.number).toBe('PLT-000001');
    const bulk = await ok<{ created: number; plantCount: number }>(
      post(`/plantings/${palmPlanting.id}/plants/bulk`, {
        rows: [
          { unitId: r1.id, count: 5 },
          { unitId: r2.id, count: 5 },
        ],
        sex: 'female',
      }),
    );
    expect(bulk).toEqual({ created: 10, plantCount: 10 });
    // صف خارج وحدة الزراعة يُرفض
    await post(`/plantings/${palmPlanting.id}/plants/bulk`, {
      rows: [{ unitId: field.id, count: 1 }],
    }).expect(400);
    const plants = (
      await ok<{ data: Plant[] }>(
        get(`/farm-plants?plantingId=${palmPlanting.id}&limit=50`),
      )
    ).data;
    expect(plants.map((p) => p.tag)).toEqual([
      'A-B1-R1-01',
      'A-B1-R1-02',
      'A-B1-R1-03',
      'A-B1-R1-04',
      'A-B1-R1-05',
      'A-B1-R2-01',
      'A-B1-R2-02',
      'A-B1-R2-03',
      'A-B1-R2-04',
      'A-B1-R2-05',
    ]);
    const tag = (t: string) => plants.find((p) => p.tag === t)!;

    // ─── زراعة القمح: الحصاد المتوقع والخطة من التقويم ───
    const wheatPlanting = await ok<{
      id: string;
      expectedHarvestAt: string;
      expectedYield: number;
      areaM2: number;
    }>(
      post('/plantings', {
        unitId: field.id,
        cropId: wheat.id,
        varietyId: wheatVariety.id,
        plantedAt: '2026-11-01',
        season: '2026/2027',
        generatePlan: true,
      }),
    );
    expect(wheatPlanting).toMatchObject({
      expectedHarvestAt: '2027-03-31',
      expectedYield: 5000,
      areaM2: 10000,
    });
    const planned = await ok<{ data: (Operation & { plannedDate: string })[] }>(
      get(`/farm-operations?plantingId=${wheatPlanting.id}&status=planned`),
    );
    expect(planned.data.map((o) => o.plannedDate).sort()).toEqual([
      '2026-11-01',
      '2026-11-08',
      '2026-11-15',
    ]);
    expect(
      await ok<{ created: number }>(
        post(`/plantings/${wheatPlanting.id}/plan`, {}),
      ),
    ).toEqual({ created: 0 });

    // ─── تسميد الحوش: المدخل يخرج بتكلفته، والعمالة بتكلفة الساعة ───
    const fertilizing = await ok<Operation>(
      post('/farm-operations', {
        farmId: farm.id,
        unitId: block.id,
        type: 'fertilization',
        inputs: [{ productId: fertilizer.id, quantity: 20 }],
        workers: [{ name: 'علي', hours: 4 }],
      }),
    );
    expect(fertilizing).toMatchObject({
      status: 'done',
      inputCost: 60,
      laborCost: 40,
      laborHours: 4,
      plantsCovered: 10,
    });
    expect(await stockOf(fertilizer.id)).toBe(80);

    // ─── رش الصف الأول بمبيد فترة أمانه 7 أيام ───
    const spraying = await ok<Operation>(
      post('/farm-operations', {
        farmId: farm.id,
        unitId: r1.id,
        type: 'spraying',
        targetPest: 'red_palm_weevil',
        inputs: [{ productId: pesticide.id, quantity: 1, phiDays: 7 }],
      }),
    );
    expect(spraying.inputCost).toBe(50);
    expect(
      spraying.harvestAllowedAt! > new Date().toISOString().slice(0, 10),
    ).toBe(true);

    // ─── تلقيح 3 نخلات بعينها ───
    const pollination = await ok<Operation>(
      post('/farm-operations', {
        farmId: farm.id,
        plantingId: palmPlanting.id,
        type: 'pollination',
        quantity: 9,
        quantityUnit: 'عذق',
        plantIds: [
          tag('A-B1-R1-01').id,
          tag('A-B1-R1-03').id,
          tag('A-B1-R2-01').id,
        ],
      }),
    );
    expect(pollination.plants).toHaveLength(3);
    expect(pollination.plantsCovered).toBe(3);
    // نخلة من زراعة أخرى لا تُستهدف
    await post('/farm-operations', {
      farmId: farm.id,
      plantingId: wheatPlanting.id,
      type: 'pollination',
      plantIds: [tag('A-B1-R1-01').id],
    }).expect(400);
    const plantOps = await ok<{ data: Operation[] }>(
      get(`/farm-operations?plantId=${tag('A-B1-R1-03').id}`),
    );
    // التلقيح (مستهدفة) والرش (صفها) والتسميد (حوشها)
    expect(plantOps.data.map((o) => o.number).sort()).toEqual(
      [fertilizing.number, spraying.number, pollination.number].sort(),
    );

    // ─── الحصاد: داخل فترة الأمان يُقبل ويُعلَّم، وبالتكلفة المعيارية ───
    const early = await ok<Harvest>(
      post('/farm-harvests', {
        farmId: farm.id,
        plantId: tag('A-B1-R1-03').id,
        quantity: 10,
        grade: 'first',
      }),
    );
    expect(early).toMatchObject({
      phiViolation: true,
      valuation: 'standard',
      unitCost: 4,
    });
    const harvest = await ok<Harvest>(
      post('/farm-harvests', {
        farmId: farm.id,
        plantId: tag('A-B1-R2-02').id,
        quantity: 30,
        grossQuantity: 33,
        rejectQuantity: 3,
        rejectReason: 'sorting',
        containers: 4,
        containerLabel: 'عذق',
      }),
    );
    expect(harvest).toMatchObject({
      phiViolation: false,
      unitCost: 4,
      value: 120,
      status: 'recorded',
    });
    expect(harvest.lotNumber).toMatch(/^FRM-000001-\d{8}$/);
    expect(await stockOf(dates.id)).toBe(40);
    const lots = await ok<{ data: { lotNumber: string; quantity: number }[] }>(
      get(`/inventory/lots?productId=${dates.id}`),
    );
    expect(lots.data[0]).toMatchObject({
      lotNumber: harvest.lotNumber,
      quantity: 40,
    });

    // ─── الآفات: سوسة على نخلة ← مصابة، وتظهر على الخريطة ───
    const inspection = await ok<{ id: string; status: string }>(
      post('/farm-inspections', {
        farmId: farm.id,
        plantId: tag('A-B1-R2-01').id,
        pest: 'red_palm_weevil',
        severity: 3,
      }),
    );
    expect(inspection.status).toBe('open');
    expect(
      (await ok<Plant>(get(`/farm-plants/${tag('A-B1-R2-01').id}`))).status,
    ).toBe('infested');
    const map = await ok<{
      units: {
        id: string;
        infestedPlants: number;
        openInspections: number;
        maxSeverity: number;
        livePlants: number;
        harvestAllowedAt: string | null;
        irrigationDue: boolean;
      }[];
    }>(get(`/farms/${farm.id}/map`));
    const mapOf = (id: string) => map.units.find((u) => u.id === id)!;
    expect(mapOf(block.id)).toMatchObject({
      infestedPlants: 1,
      openInspections: 1,
      maxSeverity: 3,
      livePlants: 10,
    });
    expect(mapOf(r1.id).harvestAllowedAt).not.toBeNull();
    expect(mapOf(r2.id).harvestAllowedAt).toBeNull();
    // لم يُروَ ولها موعد كل 3 أيام (من القطاع)
    expect(mapOf(r3.id).irrigationDue).toBe(true);
    await ok(
      post(`/farm-inspections/${inspection.id}/status`, { status: 'resolved' }),
    );
    expect(
      (await ok<Plant>(get(`/farm-plants/${tag('A-B1-R2-01').id}`))).status,
    ).toBe('healthy');

    // ─── نخلة ماتت (بسببها) وبديلها في نفس الموقع ───
    await post(`/farm-plants/${tag('A-B1-R1-02').id}/status`, {
      status: 'dead',
    }).expect(400);
    await ok(
      post(`/farm-plants/${tag('A-B1-R1-02').id}/status`, {
        status: 'dead',
        removalReason: 'pest',
      }),
    );
    expect(
      (await ok<{ plantCount: number }>(get(`/plantings/${palmPlanting.id}`)))
        .plantCount,
    ).toBe(9);
    const replacement = await ok<Plant>(
      post(`/plantings/${palmPlanting.id}/plants`, {
        unitId: r1.id,
        replacesPlantId: tag('A-B1-R1-02').id,
        source: 'offshoot',
        motherPlantId: tag('A-B1-R1-01').id,
      }),
    );
    expect(replacement).toMatchObject({ tag: 'A-B1-R1-02B', position: 2 });
    const detail = await ok<{
      plantCount: number;
      plantsByStatus: Record<string, number>;
      harvest: { quantity: number };
      expected: number;
    }>(get(`/plantings/${palmPlanting.id}`));
    expect(detail).toMatchObject({
      plantCount: 10,
      plantsByStatus: { healthy: 10, dead: 1 },
      harvest: { quantity: 40 },
      expected: 500,
    });

    // ─── التقارير: الإنتاجية مقابل المتوقع، وتكلفة الكيلو ───
    const yields = await ok<{
      rows: {
        key: string;
        quantity: number;
        perPlant: number;
        expected: number;
        achievement: number;
        rejectQuantity: number;
      }[];
    }>(get(`/farm-reports/yield?farmId=${farm.id}`));
    expect(yields.rows.find((r) => r.key === palmPlanting.id)).toMatchObject({
      quantity: 40,
      rejectQuantity: 3,
      perPlant: 4,
      expected: 500,
      achievement: 8,
    });
    const byPlant = await ok<{ top: { tag: string; quantity: number }[] }>(
      get(`/farm-reports/yield?farmId=${farm.id}&groupBy=plant`),
    );
    expect(byPlant.top[0]).toEqual(
      expect.objectContaining({ tag: 'A-B1-R2-02', quantity: 30 }),
    );
    const costs = await ok<{
      rows: {
        plantingId: string;
        inputCost: number;
        laborCost: number;
        totalCost: number;
        harvestQuantity: number;
        costPerUnit: number;
        margin: number;
      }[];
    }>(get(`/farm-reports/costs?farmId=${farm.id}`));
    // تسميد الحوش (60 + عمالة 40) ورش صفّه (50) تُحمَّل على نخيله
    expect(
      costs.rows.find((r) => r.plantingId === palmPlanting.id),
    ).toMatchObject({
      inputCost: 110,
      laborCost: 40,
      totalCost: 150,
      harvestQuantity: 40,
      costPerUnit: 3.75,
      margin: 10,
    });

    // ─── الإلغاء: حصاد سُجّل خطأً، وتسميد أُبطل (يعود السماد) ───
    const voided = await ok<Harvest>(
      post(`/farm-harvests/${early.id}/void`, { reason: 'وزن خاطئ' }),
    );
    expect(voided.status).toBe('voided');
    expect(await stockOf(dates.id)).toBe(30);
    await ok(
      post(`/farm-operations/${fertilizing.id}/cancel`, { reason: 'تكرار' }),
    );
    expect(await stockOf(fertilizer.id)).toBe(100);
    await post(`/farm-operations/${fertilizing.id}/cancel`, {
      reason: 'مرة ثانية',
    }).expect(400);

    // ─── القيود: المبيد وحده في التكاليف، والحصاد الباقي في المحمّل ───
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
    expect(await closing('farm_costs')).toBe(50);
    expect(await closing('farm_absorbed')).toBe(-120);

    // ─── الشاشة الميدانية: تنزيل ثم رفع ما سُجّل بلا إنترنت ───
    const boot = await ok<{
      plants: { id: string }[];
      units: { id: string }[];
      plannedOperations: { id: string; plantingId: string }[];
      products: { id: string }[];
    }>(get(`/farm-field/bootstrap?farmId=${farm.id}`));
    expect(boot.plants).toHaveLength(11);
    expect(boot.products.some((p) => p.id === fertilizer.id)).toBe(true);
    const wheatPlan = boot.plannedOperations.find(
      (o) => o.plantingId === wheatPlanting.id,
    )!;
    const at = new Date(Date.now() - 3_600_000).toISOString();
    const ops = [
      {
        id: randomUUID(),
        type: 'operation',
        occurredAt: at,
        payload: {
          farmId: farm.id,
          unitId: r3.id,
          type: 'irrigation',
          waterM3: 50,
          durationMinutes: 90,
          futureField: 'جهاز أحدث',
        },
      },
      {
        id: randomUUID(),
        type: 'operation_complete',
        occurredAt: at,
        payload: { operationId: wheatPlan.id, waterM3: 40 },
      },
      {
        id: randomUUID(),
        type: 'harvest',
        occurredAt: at,
        payload: {
          farmId: farm.id,
          unitId: r3.id,
          plantingId: palmPlanting.id,
          quantity: 5,
        },
      },
      {
        id: randomUUID(),
        type: 'inspection',
        occurredAt: at,
        payload: {
          farmId: farm.id,
          unitId: r1.id,
          pest: 'dubas_bug',
          severity: 1,
        },
      },
      {
        id: randomUUID(),
        type: 'plant_status',
        occurredAt: at,
        payload: {
          plantId: tag('A-B1-R2-03').id,
          status: 'weak',
          reason: 'اصفرار',
        },
      },
      {
        id: randomUUID(),
        type: 'operation',
        occurredAt: at,
        payload: { farmId: farm.id, unitId: randomUUID(), type: 'weeding' },
      },
    ];
    const first = await ok<{
      results: { id: string; status: string; message?: string }[];
    }>(post('/farm-field/sync', { operations: ops }));
    expect(first.results.map((r) => r.status)).toEqual([
      'ok',
      'ok',
      'ok',
      'ok',
      'ok',
      'error',
    ]);
    expect(first.results[5].message).toBe('الوحدة غير موجودة');
    // انقطع الرد بعد التنفيذ: الإعادة لا تكرر شيئاً
    const again = await ok<{ results: { status: string }[] }>(
      post('/farm-field/sync', { operations: ops }),
    );
    expect(again.results.map((r) => r.status)).toEqual([
      'duplicate',
      'duplicate',
      'duplicate',
      'duplicate',
      'duplicate',
      'error',
    ]);
    const irrigation = (
      await ok<{ data: Operation[] }>(
        get(`/farm-operations?unitId=${r3.id}&type=irrigation`),
      )
    ).data;
    expect(irrigation).toHaveLength(1);
    expect(irrigation[0].waterM3).toBe(50);
    expect(
      (await ok<Operation>(get(`/farm-operations/${wheatPlan.id}`))).status,
    ).toBe('done');
    expect(await stockOf(dates.id)).toBe(35);
    expect(
      (await ok<Plant>(get(`/farm-plants/${tag('A-B1-R2-03').id}`))).status,
    ).toBe('weak');
    // الري أزال تنبيه "محتاج ري" عن الصف الثالث
    const after = await ok<{ units: { id: string; irrigationDue: boolean }[] }>(
      get(`/farms/${farm.id}/map`),
    );
    expect(after.units.find((u) => u.id === r3.id)!.irrigationDue).toBe(false);

    // ─── اللوحة وسجل النخيل ───
    const dashboard = await ok<{
      plants: { live: number };
      inspections: { open: number };
      harvest: { productId: string; quantity: number }[];
    }>(get(`/farm-reports/dashboard?farmId=${farm.id}`));
    expect(dashboard.plants.live).toBe(10);
    expect(dashboard.inspections.open).toBe(1);
    expect(
      dashboard.harvest.find((h) => h.productId === dates.id)!.quantity,
    ).toBe(35);
    const registry = await ok<{
      bySex: Record<string, number>;
      removals: { reason: string; count: number }[];
      origins: { source: string; replacements: number }[];
    }>(get(`/farm-reports/registry?farmId=${farm.id}`));
    expect(registry.bySex).toEqual({ female: 9, unknown: 1 });
    expect(registry.removals).toEqual([{ reason: 'pest', count: 1 }]);
    expect(
      registry.origins.find((o) => o.source === 'offshoot')!.replacements,
    ).toBe(1);
    const water = await ok<{ byUnit: { unitId: string; waterM3: number }[] }>(
      get(`/farm-reports/water?farmId=${farm.id}`),
    );
    expect(water.byUnit.map((u) => u.waterM3).sort()).toEqual([40, 50]);

    // ─── الحذف: مزرعة عليها عمل لا تُحذف ───
    await del(`/farms/${farm.id}`).expect(409);
  });

  it('keeps farms inside the user branches and the plan feature', async () => {
    const other = await createTenantFixture(dataSource, {
      features: ['products_module', 'inventory_module'],
    });
    await api()
      .get('/farms')
      .set({ Authorization: `Bearer ${other.adminToken}` })
      .expect(403);
    const farm = await ok<Named>(post('/farms', { name: 'مزرعة' }));
    // شركة أخرى لا ترى مزرعة غيرها
    const third = await createTenantFixture(dataSource, {
      features: ['products_module', 'inventory_module', 'farms_module'],
    });
    await api()
      .get(`/farms/${farm.id}`)
      .set({ Authorization: `Bearer ${third.adminToken}` })
      .expect(404);
    // صلاحية العرض وحدها لا تسجّل عملاً ميدانياً
    const viewer = tenant.tokenWith(['view_farms']);
    await api()
      .post('/farm-operations')
      .set({ Authorization: `Bearer ${viewer}` })
      .send({ farmId: farm.id, type: 'weeding' })
      .expect(403);
  });
});
