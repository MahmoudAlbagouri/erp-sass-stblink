import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { CatalogSettingsService } from '../src/modules/catalog/catalog-settings.service';
import { ProductBarcode } from '../src/modules/catalog/entities/product-barcode.entity';
import { ProductCategory } from '../src/modules/catalog/entities/product-category.entity';
import { Product } from '../src/modules/catalog/entities/product.entity';
import { TaxRate } from '../src/modules/catalog/entities/tax-rate.entity';
import { Unit } from '../src/modules/catalog/entities/unit.entity';
import { ProductsService } from '../src/modules/catalog/products.service';
import { InventoryItem } from '../src/modules/inventory/entities/inventory-item.entity';
import { StockLevel } from '../src/modules/inventory/entities/stock-level.entity';
import { StockMovement } from '../src/modules/inventory/entities/stock-movement.entity';
import { StockTransfer } from '../src/modules/inventory/entities/stock-transfer.entity';
import { Warehouse } from '../src/modules/inventory/entities/warehouse.entity';
import { StockService } from '../src/modules/inventory/stock.service';
import { WarehousesService } from '../src/modules/inventory/warehouses.service';
import { PosOperationDto } from '../src/modules/pos/dto/pos.dto';
import {
  PosCashier,
  PosDevice,
  PosShift,
  PosShiftStatus,
} from '../src/modules/pos/entities/pos.entity';
import { PosCashiersService } from '../src/modules/pos/pos-cashiers.service';
import { PosExtrasService } from '../src/modules/pos/pos-extras.service';
import {
  PosAuditLog,
  PosCashMovement,
  PosPromotion,
} from '../src/modules/pos/entities/pos-extras.entity';
import { PosService } from '../src/modules/pos/pos.service';
import { CustomersService } from '../src/modules/sales/customers.service';
import { CustomerPayment } from '../src/modules/sales/entities/customer-payment.entity';
import { Customer } from '../src/modules/sales/entities/customer.entity';
import {
  SalesInvoice,
  SalesInvoiceStatus,
} from '../src/modules/sales/entities/sales-invoice.entity';
import { SalesSettings } from '../src/modules/sales/entities/sales-settings.entity';
import { SalesInvoicesService } from '../src/modules/sales/sales-invoices.service';
import { SalesReturnsService } from '../src/modules/sales/sales-returns.service';
import { SalesReturn } from '../src/modules/sales/entities/sales-return.entity';
import { SalesSettingsService } from '../src/modules/sales/sales-settings.service';
import { Tenant } from '../src/modules/tenants/entities/tenant.entity';
import { dayKeyInZone } from '../src/common/utils/timezone.util';
import { PosDocumentDates1791912700000 } from '../src/database/migrations/1791912700000-PosDocumentDates';
import { createTestDataSource, truncateAllTables } from './utils/test-database';

describe('pos module', () => {
  let dataSource: DataSource;
  let settings: CatalogSettingsService;
  let products: ProductsService;
  let warehouses: WarehousesService;
  let stock: StockService;
  let customers: CustomersService;
  let invoices: SalesInvoicesService;
  let pos: PosService;
  let cashiers: PosCashiersService;

  let tenantA: string;
  let tenantB: string;
  let main: Warehouse;
  let branch: Warehouse;
  let device: PosDevice;
  let piece: Unit;
  let carton: Unit;
  /** مياه: 2.30 شامل الضريبة (2.00 + 0.30) */
  let water: Product;

  const quantityIn = async (warehouse: Warehouse) =>
    (await stock.getQuantities(tenantA, warehouse.id, [water.id])).get(
      water.id,
    ) ?? 0;

  // ─── عمليات كما يرسلها الجهاز ───
  const openOp = (id: string, openingCash = 100): PosOperationDto => ({
    id: `open-${id}`,
    type: 'shift.open',
    payload: {
      id,
      openedAt: '2026-10-12T05:00:00.000Z',
      openingCash,
      cashierName: 'سالم',
    },
  });

  const closeOp = (id: string, closingCash: number): PosOperationDto => ({
    id: `close-${id}`,
    type: 'shift.close',
    payload: { id, closedAt: '2026-10-12T14:00:00.000Z', closingCash },
  });

  /** بيع `quantity` قطعة مياه نقداً (أو بالطريقة المحددة) */
  const saleOp = (
    shiftId: string,
    counter: number,
    quantity = 2,
    overrides: Record<string, unknown> = {},
  ): PosOperationDto => {
    const total = Math.round(quantity * 2.3 * 100) / 100;
    const subtotal = Math.round((total / 1.15) * 100) / 100;
    return {
      id: `sale-${counter}`,
      type: 'sale',
      payload: {
        uuid: randomUUID(),
        number: `${device.code}-${String(counter).padStart(6, '0')}`,
        issuedAt: `2026-10-12T0${5 + (counter % 4)}:30:00.000Z`,
        shiftId,
        pricesIncludeTax: true,
        lines: [
          {
            productId: water.id,
            quantity,
            unitPrice: 2.3,
            discount: 0,
            taxRate: 15,
            subtotal,
            taxAmount: Math.round((total - subtotal) * 100) / 100,
            total,
          },
        ],
        payments: [{ method: 'cash', amount: total }],
        ...overrides,
      },
    };
  };

  /** الشاشة المربوطة بالجهاز في هذه الاختبارات */
  const screen = randomUUID();

  const sync = (
    operations: PosOperationDto[],
    tenantId = tenantA,
    installationId = screen,
    canReturn = true,
  ) =>
    pos.sync({ deviceId: device.id, installationId, operations }, tenantId, {
      id: undefined,
      canReturn,
    });

  /** مرتجع من الفاتورة رقم `counter`: كمية من سطرها الأول */
  const returnOp = (
    shiftId: string,
    counter: number,
    quantity: number,
    refundAmount: number,
    overrides: Record<string, unknown> = {},
  ): PosOperationDto => {
    const uuid = randomUUID();
    return {
      id: `return-${uuid}`,
      type: 'return',
      payload: {
        uuid,
        invoiceNumber: `POS1-${String(counter).padStart(6, '0')}`,
        issuedAt: '2026-10-12T09:00:00.000Z',
        shiftId,
        lines: [{ lineIndex: 0, quantity }],
        refundMethod: 'cash',
        refundAmount,
        ...overrides,
      },
    };
  };

  beforeAll(async () => {
    dataSource = await createTestDataSource();
    settings = new CatalogSettingsService(
      dataSource.getRepository(ProductCategory),
      dataSource.getRepository(Unit),
      dataSource.getRepository(TaxRate),
      dataSource.getRepository(Product),
    );
    products = new ProductsService(
      dataSource.getRepository(Product),
      dataSource.getRepository(ProductBarcode),
      settings,
      dataSource,
    );
    warehouses = new WarehousesService(
      dataSource.getRepository(Warehouse),
      dataSource.getRepository(StockLevel),
      dataSource.getRepository(StockTransfer),
    );
    stock = new StockService(
      dataSource.getRepository(StockLevel),
      dataSource.getRepository(StockMovement),
      dataSource.getRepository(InventoryItem),
      warehouses,
      products,
      dataSource,
    );
    customers = new CustomersService(
      dataSource.getRepository(Customer),
      dataSource,
    );
    const salesSettings = new SalesSettingsService(
      dataSource.getRepository(SalesSettings),
    );
    invoices = new SalesInvoicesService(
      dataSource.getRepository(SalesInvoice),
      customers,
      warehouses,
      products,
      stock,
      salesSettings,
      dataSource,
    );
    cashiers = new PosCashiersService(dataSource.getRepository(PosCashier));
    pos = new PosService(
      dataSource.getRepository(PosDevice),
      dataSource.getRepository(PosShift),
      warehouses,
      products,
      settings,
      customers,
      salesSettings,
      invoices,
      new SalesReturnsService(
        dataSource.getRepository(SalesReturn),
        invoices,
        stock,
        dataSource,
      ),
      cashiers,
      new PosExtrasService(
        dataSource.getRepository(PosCashMovement),
        dataSource.getRepository(PosAuditLog),
        dataSource.getRepository(PosPromotion),
      ),
    );
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    const tenants = dataSource.getRepository(Tenant);
    tenantA = (await tenants.save({ companyName: 'شركة أ' })).id;
    tenantB = (await tenants.save({ companyName: 'شركة ب' })).id;

    main = await warehouses.getMain(tenantA);
    branch = await warehouses.create({ name: 'فرع العليا' }, tenantA);
    device = await pos.createDevice(
      { name: 'كاشير 1', code: 'POS1', warehouseId: branch.id },
      tenantA,
    );
    await pos.bindDevice(device.id, screen, tenantA);

    const units = await settings.findUnits(tenantA);
    piece = units.find((u) => u.name === 'قطعة')!;
    carton = units.find((u) => u.name === 'كرتون')!;
    water = await products.create(
      {
        name: 'مياه 330 مل',
        baseUnitId: piece.id,
        salePrice: 2.3,
        minSalePrice: 2,
        units: [{ unitId: carton.id, factor: 24, salePrice: 50 }],
        barcodes: [{ barcode: '6281000000017' }],
      },
      tenantA,
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  // ─── الأجهزة ────────────────────────────────────────────────
  describe('devices', () => {
    it('never reuses a device code, even after deletion', async () => {
      await expect(
        pos.createDevice(
          { name: 'آخر', code: 'POS1', warehouseId: branch.id },
          tenantA,
        ),
      ).rejects.toThrow('مستخدم لجهاز آخر');

      await pos.removeDevice(device.id, tenantA);
      await expect(
        pos.createDevice(
          { name: 'بديل', code: 'POS1', warehouseId: branch.id },
          tenantA,
        ),
      ).rejects.toThrow('مستخدم لجهاز آخر');
      // شركة أخرى لها أكوادها
      const otherMain = await warehouses.getMain(tenantB);
      await pos.createDevice(
        { name: 'كاشير', code: 'POS1', warehouseId: otherMain.id },
        tenantB,
      );
    });

    it('keeps the code fixed and protects a device with an open shift', async () => {
      await expect(
        pos.updateDevice(device.id, { code: 'POS9' }, tenantA),
      ).rejects.toThrow('لا يُعدَّل');

      await sync([openOp(randomUUID())]);
      await expect(pos.removeDevice(device.id, tenantA)).rejects.toThrow(
        'وردية مفتوحة',
      );
      await expect(
        pos.updateDevice(device.id, { warehouseId: main.id }, tenantA),
      ).rejects.toThrow('وردية مفتوحة');
      expect((await pos.findDevices(tenantA))[0].hasOpenShift).toBe(true);
    });

    it('isolates tenants', async () => {
      await expect(pos.findDevice(device.id, tenantB)).rejects.toThrow(
        'جهاز الكاشير غير موجود',
      );
      await expect(sync([], tenantB)).rejects.toThrow('جهاز الكاشير غير موجود');
      await expect(pos.bootstrap(device.id, screen, tenantB)).rejects.toThrow(
        'جهاز الكاشير غير موجود',
      );
    });
  });

  // ─── ربط الجهاز بشاشة واحدة ─────────────────────────────────
  describe('binding', () => {
    it('lets one screen only work on a device', async () => {
      const phone = randomUUID();

      // نفس الشاشة تعيد الربط بلا مشكلة، وشاشة أخرى تُرفض
      await expect(
        pos.bindDevice(device.id, screen, tenantA),
      ).resolves.toMatchObject({ installationId: screen });
      await expect(pos.bindDevice(device.id, phone, tenantA)).rejects.toThrow(
        'مربوط بشاشة كاشير أخرى',
      );

      // ولا تنزّل بياناته ولا ترفع عليه
      await expect(pos.bootstrap(device.id, phone, tenantA)).rejects.toThrow(
        'ليست المربوطة بالجهاز',
      );
      const shiftId = randomUUID();
      await expect(
        sync([openOp(shiftId), saleOp(shiftId, 1)], tenantA, phone),
      ).rejects.toThrow('ليست المربوطة بالجهاز');
      expect((await pos.findDevice(device.id, tenantA)).lastCounter).toBe(0);
    });

    it('moves a device to another screen only after unbinding', async () => {
      const phone = randomUUID();

      const freed = await pos.unbindDevice(device.id, tenantA);
      expect(freed.installationId).toBeNull();
      // جهاز غير مربوط لا يقبل مزامنة من أحد
      await expect(sync([])).rejects.toThrow('ليست المربوطة بالجهاز');

      await pos.bindDevice(device.id, phone, tenantA);
      await expect(sync([], tenantA, phone)).resolves.toBeDefined();
      await expect(sync([])).rejects.toThrow('ليست المربوطة بالجهاز');
    });

    it('binds once when two screens race for a free device', async () => {
      await pos.unbindDevice(device.id, tenantA);
      const screens = [randomUUID(), randomUUID(), randomUUID()];

      const results = await Promise.allSettled(
        screens.map((id) => pos.bindDevice(device.id, id, tenantA)),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const winner = (await pos.findDevice(device.id, tenantA)).installationId;
      expect(screens).toContain(winner);
    });

    it('frees the previous device when a screen moves to another', async () => {
      const second = await pos.createDevice(
        { name: 'كاشير 2', code: 'POS2', warehouseId: device.warehouseId },
        tenantA,
      );

      await pos.bindDevice(second.id, screen, tenantA);

      expect(
        (await pos.findDevice(device.id, tenantA)).installationId,
      ).toBeNull();
      expect((await pos.findDevice(second.id, tenantA)).installationId).toBe(
        screen,
      );
    });
  });

  // ─── التنزيل للجهاز ─────────────────────────────────────────
  describe('bootstrap', () => {
    it('sends everything the device needs to sell offline', async () => {
      const customer = await customers.create({ name: 'مطعم الريف' }, tenantA);

      const data = await pos.bootstrap(device.id, screen, tenantA);

      expect(data.full).toBe(true);
      expect(data.device).toMatchObject({ code: 'POS1', lastCounter: 0 });
      expect(data.openShift).toBeNull();
      expect(data.products).toMatchObject([
        {
          id: water.id,
          salePrice: 2.3,
          taxRate: 15,
          priceIncludesTax: true,
          minSalePrice: 2,
          available: true,
          barcodes: [{ barcode: '6281000000017', unitId: null }],
          units: [
            { unitId: carton.id, name: 'كرتون', factor: 24, salePrice: 50 },
          ],
        },
      ]);
      expect(data.customers).toMatchObject([
        { id: customer.id, name: 'مطعم الريف', available: true },
      ]);
    });

    it('sends only what changed since the last sync', async () => {
      const first = await pos.bootstrap(device.id, screen, tenantA);
      const unchanged = await pos.bootstrap(
        device.id,
        screen,
        tenantA,
        first.serverTime,
      );
      expect(unchanged).toMatchObject({ full: false, products: [] });

      const juice = await products.create(
        { name: 'عصير', baseUnitId: piece.id, salePrice: 5 },
        tenantA,
      );
      await products.remove(water.id, tenantA);

      const delta = await pos.bootstrap(
        device.id,
        screen,
        tenantA,
        first.serverTime,
      );
      const byId = new Map(delta.products.map((p) => [p.id, p]));

      expect(delta.products).toHaveLength(2);
      expect(byId.get(juice.id)?.available).toBe(true);
      expect(byId.get(water.id)?.available).toBe(false); // ليزيله الجهاز
    });
  });

  // ─── الرفع من الجهاز ────────────────────────────────────────
  describe('sync', () => {
    it('records a whole shift exactly as the device sold it', async () => {
      const shiftId = randomUUID();

      const { results, lastCounter } = await sync([
        openOp(shiftId, 100),
        saleOp(shiftId, 1, 2), // 4.60 نقداً
        saleOp(shiftId, 2, 10, {
          // 23.00: نقدي 3 + شبكة 20
          payments: [
            { method: 'cash', amount: 3 },
            { method: 'card', amount: 20, reference: 'AUTH-1' },
          ],
        }),
        closeOp(shiftId, 105), // في الدرج 105 والمفترض 107.60
      ]);

      expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
      expect(lastCounter).toBe(2);

      const list = await invoices.findAll(tenantA, {});
      const first = list.data.find((i) => i.number === 'POS1-000001')!;
      expect(list.total).toBe(2);
      expect(first).toMatchObject({
        status: SalesInvoiceStatus.ISSUED,
        total: 4.6,
        paidAmount: 4.6,
        paymentStatus: 'paid',
        warehouseId: branch.id,
        deviceId: device.id,
        shiftId,
      });
      // وقت البيع على الجهاز لا وقت الرفع
      expect(first.issuedAt?.toISOString()).toBe('2026-10-12T06:30:00.000Z');
      // الفرع يسمح بالسالب: الكاشير باع قبل تسجيل التوريد
      expect(await quantityIn(branch)).toBe(-12);

      const { data: shifts } = await pos.findShifts(tenantA, {});
      expect(shifts[0]).toMatchObject({
        status: PosShiftStatus.CLOSED,
        cashierName: 'سالم',
        invoicesCount: 2,
        salesTotal: 27.6,
        cashTotal: 7.6,
        cardTotal: 20,
        expectedCash: 107.6,
        closingCash: 105,
        cashDifference: -2.6,
      });
    });

    it('is safe to upload the same queue twice', async () => {
      const shiftId = randomUUID();
      const queue = [openOp(shiftId), saleOp(shiftId, 1, 2)];

      await sync(queue);
      const again = await sync(queue); // انقطع الرد فأعاد الجهاز الرفع

      expect(again.results.map((r) => r.status)).toEqual([
        'duplicate',
        'duplicate',
      ]);
      expect((await invoices.findAll(tenantA, {})).total).toBe(1);
      expect(await quantityIn(branch)).toBe(-2);
      expect(await dataSource.getRepository(CustomerPayment).count()).toBe(1);
    });

    it('rejects one bad operation without stopping the rest', async () => {
      const shiftId = randomUUID();

      const { results } = await sync([
        openOp(shiftId),
        // مبالغ لا تطابق الحساب (الإجمالي يجب أن يكون 4.60)
        saleOp(shiftId, 1, 2, {
          lines: [
            {
              productId: water.id,
              quantity: 2,
              unitPrice: 2.3,
              discount: 0,
              taxRate: 15,
              subtotal: 8.7,
              taxAmount: 1.3,
              total: 10,
            },
          ],
          payments: [{ method: 'cash', amount: 10 }],
        }),
        saleOp(shiftId, 2, 1, { number: 'POS9-000002' }), // رقم جهاز آخر
        saleOp(shiftId, 3, 1, { uuid: 'not-a-uuid' }), // بيانات فاسدة
        saleOp(randomUUID(), 4, 1), // وردية غير مسجّلة
        saleOp(shiftId, 5, 1),
      ]);

      expect(results.map((r) => r.status)).toEqual([
        'ok',
        'error',
        'error',
        'error',
        'error',
        'ok',
      ]);
      expect(results[1].message).toContain('لا تطابق الحساب');
      expect(results[2].message).toContain('لا يخص الجهاز');
      expect(results[4].message).toContain('غير مسجّلة');
      expect((await invoices.findAll(tenantA, {})).total).toBe(1);
      expect(await quantityIn(branch)).toBe(-1);
    });

    it('requires the sale to be paid in full', async () => {
      const shiftId = randomUUID();

      const { results } = await sync([
        openOp(shiftId),
        saleOp(shiftId, 1, 2, { payments: [{ method: 'cash', amount: 4 }] }),
      ]);

      expect(results[1]).toMatchObject({ status: 'error' });
      expect(results[1].message).toContain('لا يساوي إجمالي الفاتورة');
    });

    it('records the sale even if rules changed after it happened', async () => {
      const shiftId = randomUUID();
      // بعد البيع (وقبل الرفع) أُوقف الصنف ورُفع أقل سعر له
      await products.update(
        water.id,
        { isActive: false, minSalePrice: 2.3 },
        tenantA,
      );

      const { results } = await sync([
        openOp(shiftId),
        // بيع بـ 2.00 (أقل من الحد الجديد): وقع فعلاً فيُسجَّل
        {
          ...saleOp(shiftId, 1, 1),
          payload: {
            ...saleOp(shiftId, 1, 1).payload,
            lines: [
              {
                productId: water.id,
                quantity: 1,
                unitPrice: 2,
                discount: 0,
                taxRate: 15,
                subtotal: 1.74,
                taxAmount: 0.26,
                total: 2,
              },
            ],
            payments: [{ method: 'cash', amount: 2 }],
          },
        },
      ]);

      expect(results.map((r) => r.status)).toEqual(['ok', 'ok']);
    });

    it('sells in a larger unit and names the customer', async () => {
      const customer = await customers.create(
        { name: 'مطعم الريف', taxNumber: '310000000000003' },
        tenantA,
      );
      const shiftId = randomUUID();

      await sync([
        openOp(shiftId),
        saleOp(shiftId, 1, 1, {
          customerId: customer.id,
          lines: [
            {
              productId: water.id,
              unitId: carton.id,
              quantity: 1,
              unitPrice: 50,
              discount: 0,
              taxRate: 15,
              subtotal: 43.48,
              taxAmount: 6.52,
              total: 50,
            },
          ],
          payments: [{ method: 'card', amount: 50 }],
        }),
      ]);

      const [invoice] = (await invoices.findAll(tenantA, {})).data;
      const full = await invoices.findOne(invoice.id, tenantA);
      expect(full).toMatchObject({
        customerId: customer.id,
        invoiceType: 'standard',
        total: 50,
      });
      expect(full.lines?.[0]).toMatchObject({
        unitName: 'كرتون',
        baseQuantity: 24,
      });
      expect(await quantityIn(branch)).toBe(-24);
      // مدفوعة كاملة: لا تترك شيئاً على العميل
      expect((await customers.findOne(customer.id, tenantA)).balance).toBe(0);
    });

    it('allows one open shift per device', async () => {
      const first = randomUUID();

      const { results } = await sync([openOp(first), openOp(randomUUID())]);

      expect(results.map((r) => r.status)).toEqual(['ok', 'error']);
      expect(results[1].message).toContain('وردية أخرى مفتوحة');

      const closed = await sync([closeOp(first, 100), closeOp(first, 100)]);
      expect(closed.results.map((r) => r.status)).toEqual(['ok', 'duplicate']);
      // بعد التقفيل تُفتح وردية جديدة، والجهاز يستعيدها من السيرفر
      const next = randomUUID();
      await sync([openOp(next)]);
      expect(
        (await pos.bootstrap(device.id, screen, tenantA)).openShift?.id,
      ).toBe(next);
    });

    it('opens one shift even when two uploads race', async () => {
      const [a, b] = await Promise.all([
        sync([openOp(randomUUID())]),
        sync([openOp(randomUUID())]),
      ]);

      const statuses = [...a.results, ...b.results].map((r) => r.status);
      expect(statuses.sort()).toEqual(['error', 'ok']);
      expect(
        await dataSource.getRepository(PosShift).count({
          where: { deviceId: device.id, status: PosShiftStatus.OPEN },
        }),
      ).toBe(1);
    });

    it('recalculates a closed shift when a late sale arrives', async () => {
      const shiftId = randomUUID();
      const late = saleOp(shiftId, 2, 2, { uuid: 'not-a-uuid' }); // يُرفض أولاً

      const first = await sync([
        openOp(shiftId, 100),
        saleOp(shiftId, 1, 2), // 4.60
        late,
        closeOp(shiftId, 109.2), // عدّ الدرج وفيه الفاتورتان: 100 + 4.60 + 4.60
      ]);
      expect(first.results.map((r) => r.status)).toEqual([
        'ok',
        'ok',
        'error',
        'ok',
      ]);
      let [shift] = (await pos.findShifts(tenantA, {})).data;
      expect(shift).toMatchObject({ expectedCash: 104.6, cashDifference: 4.6 });

      // أُصلحت الفاتورة وأُعيد رفعها بعد التقفيل
      const fixed = saleOp(shiftId, 2, 2);
      expect((await sync([fixed])).results[0].status).toBe('ok');

      [shift] = (await pos.findShifts(tenantA, {})).data;
      expect(shift).toMatchObject({
        status: PosShiftStatus.CLOSED,
        invoicesCount: 2,
        salesTotal: 9.2,
        expectedCash: 109.2,
        closingCash: 109.2,
        cashDifference: 0,
        lateOperations: 1,
      });
      expect(shift.recalculatedAt).toBeInstanceOf(Date);
      const audit = await dataSource
        .getRepository(PosAuditLog)
        .findOneByOrFail({ action: 'late_after_close' });
      expect(audit).toMatchObject({ shiftId, amount: 0 });
    });

    it('records a sale that overdraws a warehouse that forbids negatives', async () => {
      await dataSource
        .getRepository(Warehouse)
        .update({ id: branch.id }, { allowNegativeStock: false });
      const shiftId = randomUUID();

      const { results } = await sync([openOp(shiftId), saleOp(shiftId, 1, 3)]);

      // البضاعة خرجت والإيصال طُبع: يُسجَّل البيع ويُبلَّغ عن الرصيد
      expect(results.map((r) => r.status)).toEqual(['ok', 'ok']);
      expect(await quantityIn(branch)).toBe(-3);
      const audit = await dataSource
        .getRepository(PosAuditLog)
        .findOneByOrFail({ action: 'stock_overdrawn' });
      expect(audit.details).toContain('POS1-000001');
      expect(audit.details).toContain('-3');

      // لوحة التحكم ما زالت ممنوعة من السالب في هذا المخزن
      await expect(
        stock.adjust(
          {
            warehouseId: branch.id,
            type: 'adjustment' as never,
            lines: [{ productId: water.id, quantity: -1 }],
          },
          tenantA,
        ),
      ).rejects.toThrow('الرصيد غير كافٍ');
    });

    it('dates a sale by the company clock, not the server clock', async () => {
      const shiftId = randomUUID();
      // 01:30 فجر 12 أكتوبر بالرياض = 22:30 يوم 11 بتوقيت UTC
      const late = saleOp(shiftId, 1, 2, {
        issuedAt: '2026-10-11T22:30:00.000Z',
      });

      await sync([openOp(shiftId), late]);

      const [invoice] = (await invoices.findAll(tenantA, {})).data;
      expect(invoice.invoiceDate).toBe('2026-10-12');
      expect(invoice.dueDate).toBe('2026-10-12');
      const [payment] = await dataSource
        .getRepository(CustomerPayment)
        .find({ where: { invoiceId: invoice.id } });
      expect(payment.paymentDate).toBe('2026-10-12');
      // فلتر قائمة الفواتير بالتاريخ يجدها في يومها
      expect(
        (
          await invoices.findAll(tenantA, {
            from: '2026-10-12',
            to: '2026-10-12',
          })
        ).total,
      ).toBe(1);
    });

    it("counts today's sales by the company calendar", async () => {
      // منطقة تسبق UTC بـ 14 ساعة: يومها يختلف عن يوم UTC معظم اليوم
      const zone = 'Pacific/Kiritimati';
      await dataSource
        .getRepository(Tenant)
        .update({ id: tenantA }, { timezone: zone });
      const shiftId = randomUUID();
      const now = new Date();

      await sync([
        openOp(shiftId),
        saleOp(shiftId, 1, 2, { issuedAt: now.toISOString() }),
      ]);

      const [invoice] = (await invoices.findAll(tenantA, {})).data;
      expect(invoice.invoiceDate).toBe(dayKeyInZone(now, zone));
      const summary = await invoices.summary(tenantA);
      expect(summary.todaySales).toBe(4.6);
      expect(summary.monthSales).toBe(4.6);
    });

    it('re-dates earlier kiosk documents with the data-fix migration', async () => {
      const shiftId = randomUUID();
      await sync([
        openOp(shiftId),
        saleOp(shiftId, 1, 2, { issuedAt: '2026-10-11T22:30:00.000Z' }),
        returnOp(shiftId, 1, 1, 2.3, { issuedAt: '2026-10-11T23:00:00.000Z' }),
      ]);
      // كما كانت تُسجَّل قبل الإصلاح: بيوم UTC
      const [invoice] = (await invoices.findAll(tenantA, {})).data;
      await dataSource.query(
        `UPDATE sales_invoices SET "invoiceDate" = '2026-10-11', "dueDate" = '2026-10-11' WHERE id = $1`,
        [invoice.id],
      );
      await dataSource.query(
        `UPDATE sales_returns SET "returnDate" = '2026-10-11' WHERE "invoiceId" = $1`,
        [invoice.id],
      );
      await dataSource.query(
        `UPDATE customer_payments SET "paymentDate" = '2026-10-11' WHERE "invoiceId" = $1`,
        [invoice.id],
      );

      const runner = dataSource.createQueryRunner();
      try {
        await new PosDocumentDates1791912700000().up(runner);
      } finally {
        await runner.release();
      }

      const fixed = await invoices.findOne(invoice.id, tenantA);
      expect(fixed).toMatchObject({
        invoiceDate: '2026-10-12',
        dueDate: '2026-10-12',
      });
      const [salesReturn] = await dataSource
        .getRepository(SalesReturn)
        .find({ where: { invoiceId: invoice.id } });
      expect(salesReturn.returnDate).toBe('2026-10-12');
      const payments = await dataSource
        .getRepository(CustomerPayment)
        .find({ where: { invoiceId: invoice.id } });
      expect(payments.map((p) => p.paymentDate)).toEqual([
        '2026-10-12',
        '2026-10-12',
      ]);
    });

    it('flags a wrong tax rate or an unapproved price below minimum', async () => {
      const shiftId = randomUUID();
      const line = (unitPrice: number, taxRate: number) => {
        const total = unitPrice;
        const subtotal = Math.round((total / (1 + taxRate / 100)) * 100) / 100;
        return {
          productId: water.id,
          quantity: 1,
          unitPrice,
          discount: 0,
          taxRate,
          subtotal,
          taxAmount: Math.round((total - subtotal) * 100) / 100,
          total,
        };
      };

      const { results } = await sync([
        openOp(shiftId),
        // ضريبة 0% بدل 15%
        saleOp(shiftId, 1, 1, {
          lines: [line(2.3, 0)],
          payments: [{ method: 'cash', amount: 2.3 }],
        }),
        // 1.50 تحت أقل سعر (2.00) بلا موافقة
        saleOp(shiftId, 2, 1, {
          lines: [line(1.5, 15)],
          payments: [{ method: 'cash', amount: 1.5 }],
        }),
        // نفس السعر بموافقة مشرف وتعديل سعر مسجّل: لا مخالفة
        saleOp(shiftId, 3, 1, {
          lines: [{ ...line(1.5, 15), listPrice: 2.3, priceReason: 'تالف' }],
          payments: [{ method: 'cash', amount: 1.5 }],
          approvedBy: 'المشرف',
        }),
        saleOp(shiftId, 4, 1), // سليمة
      ]);

      expect(results.map((r) => r.status)).toEqual([
        'ok',
        'ok',
        'ok',
        'ok',
        'ok',
      ]);
      const flagged = await dataSource
        .getRepository(PosAuditLog)
        .find({ where: { action: 'sale_anomaly' }, order: { details: 'ASC' } });
      expect(flagged.map((f) => f.details)).toEqual([
        expect.stringMatching(/POS1-000001 .*ضريبة 0% بدل 15%/),
        expect.stringMatching(/POS1-000002 .*تحت أقل سعر/),
      ]);
    });

    it('keeps the list price of a line repriced in one invoice only', async () => {
      const shiftId = randomUUID();
      // رفع السعر من 2.30 إلى 2.50 لهذه الفاتورة (سعر الكتالوج قديم)
      const { results } = await sync([
        openOp(shiftId),
        saleOp(shiftId, 1, 1, {
          lines: [
            {
              productId: water.id,
              quantity: 1,
              unitPrice: 2.5,
              discount: 0,
              taxRate: 15,
              subtotal: 2.17,
              taxAmount: 0.33,
              total: 2.5,
              listPrice: 2.3,
              priceReason: 'سعر غير محدّث',
            },
          ],
          payments: [{ method: 'cash', amount: 2.5 }],
        }),
      ]);

      expect(results.map((r) => r.status)).toEqual(['ok', 'ok']);
      const [invoice] = (await invoices.findAll(tenantA, {})).data;
      const full = await invoices.findOne(invoice.id, tenantA);
      expect(full.lines?.[0]).toMatchObject({
        unitPrice: 2.5,
        listPrice: 2.3,
        priceReason: 'سعر غير محدّث',
      });
      // سعر الصنف نفسه لم يتغيّر
      expect((await products.findOne(water.id, tenantA)).salePrice).toBe(2.3);
      // تعديل مسجّل: ليس مخالفة
      expect(
        await dataSource
          .getRepository(PosAuditLog)
          .count({ where: { action: 'sale_anomaly' } }),
      ).toBe(0);
    });

    it('flags a price that differs from the catalog without a recorded change', async () => {
      const shiftId = randomUUID();
      const { results } = await sync([
        openOp(shiftId),
        saleOp(shiftId, 1, 1, {
          lines: [
            {
              productId: water.id,
              quantity: 1,
              unitPrice: 2.5,
              discount: 0,
              taxRate: 15,
              subtotal: 2.17,
              taxAmount: 0.33,
              total: 2.5,
            },
          ],
          payments: [{ method: 'cash', amount: 2.5 }],
        }),
      ]);

      expect(results.map((r) => r.status)).toEqual(['ok', 'ok']);
      const [flag] = await dataSource
        .getRepository(PosAuditLog)
        .find({ where: { action: 'sale_anomaly' } });
      expect(flag.details).toContain('بسعر 2.5 بدل 2.3 بلا تعديل سعر مسجّل');
    });

    it('accepts any price for an open-price product', async () => {
      const service = await products.create(
        {
          name: 'خدمة تركيب',
          baseUnitId: piece.id,
          salePrice: 0,
          openPrice: true,
          type: 'service' as never,
        },
        tenantA,
      );
      const shiftId = randomUUID();
      const { results } = await sync([
        openOp(shiftId),
        saleOp(shiftId, 1, 1, {
          lines: [
            {
              productId: service.id,
              quantity: 1,
              unitPrice: 75,
              discount: 0,
              taxRate: 15,
              subtotal: 65.22,
              taxAmount: 9.78,
              total: 75,
            },
          ],
          payments: [{ method: 'cash', amount: 75 }],
        }),
      ]);

      expect(results.map((r) => r.status)).toEqual(['ok', 'ok']);
      expect(
        await dataSource
          .getRepository(PosAuditLog)
          .count({ where: { action: 'sale_anomaly' } }),
      ).toBe(0);
      const bootstrap = await pos.bootstrap(device.id, screen, tenantA);
      expect(
        bootstrap.products.find((p) => p.id === service.id)?.openPrice,
      ).toBe(true);
    });

    it('expects no VAT from a business that is not registered', async () => {
      await dataSource.query(
        `INSERT INTO sales_settings ("tenantId", "vatRegistered") VALUES ($1, false)`,
        [tenantA],
      );
      const shiftId = randomUUID();
      const untaxed = (counter: number) =>
        saleOp(shiftId, counter, 1, {
          lines: [
            {
              productId: water.id,
              quantity: 1,
              unitPrice: 2.3,
              discount: 0,
              taxRate: 0,
              subtotal: 2.3,
              taxAmount: 0,
              total: 2.3,
            },
          ],
          payments: [{ method: 'cash', amount: 2.3 }],
        });

      const { results } = await sync([
        openOp(shiftId),
        untaxed(1), // كما يجب: بلا ضريبة
        saleOp(shiftId, 2, 1), // شاشة لم تعرف بالتغيير: حسبت 15%
      ]);

      expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);
      const flagged = await dataSource
        .getRepository(PosAuditLog)
        .find({ where: { action: 'sale_anomaly' } });
      expect(flagged.map((f) => f.details)).toEqual([
        expect.stringMatching(/POS1-000002 .*والمنشأة غير مسجّلة/),
      ]);
      // الشاشة تعرف من بيانات الفوترة التي تنزل لها
      expect(
        (await pos.bootstrap(device.id, screen, tenantA)).settings,
      ).toMatchObject({ vatRegistered: false, pricesIncludeTax: true });
    });

    it('sends the company logo only when it changed', async () => {
      const PNG =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const first = await pos.bootstrap(device.id, screen, tenantA);
      // التنزيل الكامل يحمل الشعار دائماً (null = بلا شعار)
      expect(first.tenant).toHaveProperty('logo', null);

      // سحب "ما تغيّر": لا يُعاد الشعار والشركة لم تتغيّر
      const quiet = await pos.bootstrap(
        device.id,
        screen,
        tenantA,
        first.serverTime,
      );
      expect(quiet.tenant).not.toHaveProperty('logo');

      await new Promise((resolve) => setTimeout(resolve, 5));
      await dataSource
        .getRepository(Tenant)
        .update({ id: tenantA }, { logo_url: PNG });
      const changed = await pos.bootstrap(
        device.id,
        screen,
        tenantA,
        quiet.serverTime,
      );
      expect(changed.tenant.logo).toBe(PNG);
    });

    it("prints the customer's current balance on the invoice", async () => {
      const customer = await customers.create({ name: 'مطعم الريف' }, tenantA);
      const shiftId = randomUUID();
      // 4.60 آجلاً بالكامل لعميل مسجّل
      await sync([
        openOp(shiftId),
        saleOp(shiftId, 1, 2, { customerId: customer.id, payments: [] }),
      ]);

      const [invoice] = (await invoices.findAll(tenantA, {})).data;
      expect(
        (await invoices.findOne(invoice.id, tenantA)).customer,
      ).toMatchObject({ name: 'مطعم الريف', balance: 4.6 });
    });

    it('sends each cashier price-change permission to the device', async () => {
      await cashiers.create({ name: 'سالم', pin: '1234' }, tenantA);
      await cashiers.create(
        { name: 'منى', pin: '5678', canChangePrice: false },
        tenantA,
      );

      const { cashiers: list, posOptions } = await pos.bootstrap(
        device.id,
        screen,
        tenantA,
      );
      expect(
        Object.fromEntries(list.map((c) => [c.name, c.canChangePrice])),
      ).toEqual({ سالم: true, منى: false });
      expect(posOptions.approvals.priceChange).toBe(false);
    });

    it('shares one hash chain with back-office invoices', async () => {
      const shiftId = randomUUID();
      await sync([openOp(shiftId), saleOp(shiftId, 1, 1)]);

      // فاتورة من لوحة التحكم بعدها
      const customer = await customers.create({ name: 'عميل' }, tenantA);
      await stock.adjust(
        {
          warehouseId: main.id,
          type: 'opening' as never,
          lines: [{ productId: water.id, quantity: 10, unitCost: 1 }],
        },
        tenantA,
      );
      const draft = await invoices.create(
        {
          customerId: customer.id,
          warehouseId: main.id,
          invoiceDate: '2026-10-12',
          lines: [{ productId: water.id, quantity: 1, unitPrice: 2.3 }],
        },
        tenantA,
      );
      const office = await invoices.issue(draft.id, {}, tenantA);

      const posInvoice = (await invoices.findAll(tenantA, {})).data.find(
        (i) => i.number === 'POS1-000001',
      )!;
      expect(posInvoice.counter).toBe(1);
      expect(office).toMatchObject({
        number: 'INV-000001',
        counter: 2,
        previousInvoiceHash: posInvoice.invoiceHash,
      });
    });

    it('returns goods at the till and refunds from the drawer', async () => {
      const shiftId = randomUUID();
      await sync([openOp(shiftId), saleOp(shiftId, 1, 2)]); // 2 × 2.30 نقداً
      expect(await quantityIn(branch)).toBe(-2);

      const back = returnOp(shiftId, 1, 1, 2.3, { reason: 'عبوة تالفة' });
      const first = await sync([back]);
      expect(first.results).toEqual([{ id: back.id, status: 'ok' }]);
      // إعادة الرفع لا تكرّر المرتجع ولا تعيد البضاعة مرتين
      expect((await sync([back])).results[0].status).toBe('duplicate');

      expect(await quantityIn(branch)).toBe(-1);
      const [invoice] = (await invoices.findAll(tenantA, {})).data;
      expect(invoice).toMatchObject({ returnedAmount: 2.3, paidAmount: 2.3 });
      const [saved] = await dataSource.getRepository(SalesReturn).find();
      expect(saved).toMatchObject({
        status: 'issued',
        shiftId,
        deviceId: device.id,
        total: 2.3,
        refundedAmount: 2.3,
        reason: 'عبوة تالفة',
      });
      expect(saved.number).toMatch(/^CN-/);

      // الوردية المفتوحة تعرض أرقامها حتى اللحظة
      const live = (await pos.findShifts(tenantA, {})).data[0];
      expect(live).toMatchObject({ cashRefunds: 2.3, expectedCash: 102.3 });

      // الدرج: العهدة 100 + مبيعات 4.60 − مردود 2.30
      await sync([
        {
          id: 'close',
          type: 'shift.close',
          payload: {
            id: shiftId,
            closedAt: '2026-10-12T14:00:00.000Z',
            closingCash: 102.3,
            drawerOpens: 3,
          },
        },
      ]);
      const [shift] = (await pos.findShifts(tenantA, {})).data;
      expect(shift).toMatchObject({
        status: 'closed',
        salesTotal: 4.6,
        cashTotal: 4.6,
        returnsCount: 1,
        returnsTotal: 2.3,
        cashRefunds: 2.3,
        expectedCash: 102.3,
        cashDifference: 0,
        drawerOpens: 3,
      });
    });

    it('refunds an older invoice from the drawer of the current shift', async () => {
      const morning = randomUUID();
      const evening = randomUUID();
      await sync([
        openOp(morning),
        saleOp(morning, 1, 2),
        closeOp(morning, 104.6),
        openOp(evening),
        returnOp(evening, 1, 2, 4.6, { refundMethod: 'card' }),
        saleOp(evening, 2, 1),
        returnOp(evening, 2, 1, 2.3),
        closeOp(evening, 100),
      ]);

      const shifts = (await pos.findShifts(tenantA, {})).data;
      const byId = new Map(shifts.map((shift) => [shift.id, shift]));
      // وردية الصباح مقفّلة بأرقامها: المرتجع اللاحق لا يغيّرها
      expect(byId.get(morning)).toMatchObject({
        cashTotal: 4.6,
        cashRefunds: 0,
        cashDifference: 0,
      });
      // المساء: مرتجعان، واحد منهما فقط نقدي
      expect(byId.get(evening)).toMatchObject({
        returnsCount: 2,
        returnsTotal: 6.9,
        cashTotal: 2.3,
        cashRefunds: 2.3,
        expectedCash: 100,
        cashDifference: 0,
      });
    });

    it('rejects a return the invoice does not allow', async () => {
      const shiftId = randomUUID();
      await sync([openOp(shiftId), saleOp(shiftId, 1, 2)]);

      const { results } = await sync([
        returnOp(shiftId, 1, 3, 6.9), // أكثر من المباع
        returnOp(shiftId, 1, 1, 1), // العميل العابر يُردّ له المبلغ كاملاً
        returnOp(shiftId, 9, 1, 2.3), // فاتورة غير موجودة
        returnOp(shiftId, 1, 1, 2.3, {
          lines: [{ lineIndex: 5, quantity: 1 }],
        }),
        returnOp(shiftId, 1, 2, 4.6), // صحيح: كل الكمية
        returnOp(shiftId, 1, 1, 2.3), // لم يبقَ شيء يُرجَع
      ]);

      expect(results.map((r) => r.status)).toEqual([
        'error',
        'error',
        'error',
        'error',
        'ok',
        'error',
      ]);
      expect(results[0].message).toContain('أكبر من المتاح للإرجاع');
      expect(results[1].message).toContain('يجب ردّ');
      expect(results[2].message).toContain('لا توجد فاتورة');
      expect(results[3].message).toContain('سطر ليس ضمن هذه الفاتورة');
      expect(await dataSource.getRepository(SalesReturn).count()).toBe(1);
      expect(await quantityIn(branch)).toBe(0);
    });

    it('needs the returns permission, and keeps the rest of the queue', async () => {
      const shiftId = randomUUID();
      const { results } = await sync(
        [openOp(shiftId), saleOp(shiftId, 1, 2), returnOp(shiftId, 1, 1, 2.3)],
        tenantA,
        screen,
        false,
      );

      expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'error']);
      expect(results[2].message).toContain('صلاحية');
      expect(await quantityIn(branch)).toBe(-2);
    });

    it('looks an invoice up by its printed number', async () => {
      const shiftId = randomUUID();
      await sync([
        openOp(shiftId),
        saleOp(shiftId, 1, 2),
        returnOp(shiftId, 1, 1, 2.3),
      ]);

      expect(await pos.lookupInvoice(' POS1-000001 ', tenantA)).toMatchObject({
        number: 'POS1-000001',
        customerName: null,
        total: 4.6,
        paidAmount: 2.3,
        returnedAmount: 2.3,
        lines: [{ lineIndex: 0, quantity: 2, returnedQuantity: 1, total: 4.6 }],
      });
      await expect(pos.lookupInvoice('POS1-000001', tenantB)).rejects.toThrow(
        'لا توجد فاتورة',
      );
    });

    it('refuses to sync an inactive device', async () => {
      await pos.updateDevice(device.id, { isActive: false }, tenantA);

      await expect(sync([])).rejects.toThrow('موقوف');
    });
  });
});
