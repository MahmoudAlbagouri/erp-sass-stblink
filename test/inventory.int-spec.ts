import { DataSource } from 'typeorm';
import { CatalogSettingsService } from '../src/modules/catalog/catalog-settings.service';
import { ProductBarcode } from '../src/modules/catalog/entities/product-barcode.entity';
import { ProductCategory } from '../src/modules/catalog/entities/product-category.entity';
import {
  Product,
  ProductType,
} from '../src/modules/catalog/entities/product.entity';
import { TaxRate } from '../src/modules/catalog/entities/tax-rate.entity';
import { Unit } from '../src/modules/catalog/entities/unit.entity';
import { ProductsService } from '../src/modules/catalog/products.service';
import { InventoryItem } from '../src/modules/inventory/entities/inventory-item.entity';
import { StockLevel } from '../src/modules/inventory/entities/stock-level.entity';
import {
  StockMovement,
  StockMovementType,
} from '../src/modules/inventory/entities/stock-movement.entity';
import {
  StockTransfer,
  StockTransferStatus,
} from '../src/modules/inventory/entities/stock-transfer.entity';
import {
  Stocktake,
  StocktakeStatus,
} from '../src/modules/inventory/entities/stocktake.entity';
import {
  Warehouse,
  WarehouseType,
} from '../src/modules/inventory/entities/warehouse.entity';
import { StockService } from '../src/modules/inventory/stock.service';
import { StocktakesService } from '../src/modules/inventory/stocktakes.service';
import { TransfersService } from '../src/modules/inventory/transfers.service';
import { WarehousesService } from '../src/modules/inventory/warehouses.service';
import { Tenant } from '../src/modules/tenants/entities/tenant.entity';
import { createTestDataSource, truncateAllTables } from './utils/test-database';

describe('inventory module', () => {
  let dataSource: DataSource;
  let settings: CatalogSettingsService;
  let products: ProductsService;
  let warehouses: WarehousesService;
  let stock: StockService;
  let transfers: TransfersService;
  let stocktakes: StocktakesService;

  let tenantA: string;
  let tenantB: string;
  let main: Warehouse;
  let branch: Warehouse;
  let water: Product;
  let rice: Product;

  const quantityIn = async (warehouse: Warehouse, product: Product) =>
    (
      await stock.getQuantities(warehouse.tenantId, warehouse.id, [product.id])
    ).get(product.id) ?? 0;

  const itemOf = (product: Product) =>
    dataSource
      .getRepository(InventoryItem)
      .findOneByOrFail({ tenantId: product.tenantId, productId: product.id });

  /** رصيد افتتاحي في المخزن الرئيسي */
  const open = (product: Product, quantity: number, unitCost: number) =>
    stock.adjust(
      {
        warehouseId: main.id,
        type: StockMovementType.OPENING,
        lines: [{ productId: product.id, quantity, unitCost }],
      },
      tenantA,
    );

  const adjust = (warehouse: Warehouse, product: Product, quantity: number) =>
    stock.adjust(
      {
        warehouseId: warehouse.id,
        type: StockMovementType.ADJUSTMENT,
        lines: [{ productId: product.id, quantity }],
      },
      tenantA,
    );

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
    transfers = new TransfersService(
      dataSource.getRepository(StockTransfer),
      stock,
      warehouses,
      dataSource,
    );
    stocktakes = new StocktakesService(
      dataSource.getRepository(Stocktake),
      stock,
      warehouses,
      dataSource,
    );
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    const tenants = dataSource.getRepository(Tenant);
    tenantA = (await tenants.save({ companyName: 'شركة أ' })).id;
    tenantB = (await tenants.save({ companyName: 'شركة ب' })).id;

    main = await warehouses.getMain(tenantA);
    branch = await warehouses.create({ name: 'فرع الرياض' }, tenantA);

    // الوحدات الافتراضية تُنشأ عند أول قراءة
    const baseUnitId = (await settings.findUnits(tenantA))[0].id;
    water = await products.create(
      { name: 'مياه 330 مل', baseUnitId, salePrice: 2 },
      tenantA,
    );
    rice = await products.create(
      { name: 'أرز 5 كجم', baseUnitId, salePrice: 48 },
      tenantA,
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  // ─── المخازن ────────────────────────────────────────────────
  describe('warehouses', () => {
    it('creates exactly one main warehouse per tenant', async () => {
      const list = await warehouses.findAll(tenantA);
      await warehouses.findAll(tenantA);

      expect(list.map((w) => w.type)).toEqual([
        WarehouseType.MAIN,
        WarehouseType.BRANCH,
      ]);
      expect(list[0].allowNegativeStock).toBe(false);
      expect(list[1].allowNegativeStock).toBe(true);
    });

    it('protects the main warehouse', async () => {
      await expect(warehouses.remove(main.id, tenantA)).rejects.toThrow(
        'لا يمكن حذف المخزن الرئيسي',
      );
      await expect(
        warehouses.update(main.id, { isActive: false }, tenantA),
      ).rejects.toThrow('لا يمكن إيقاف المخزن الرئيسي');
    });

    it('rejects a duplicate name', async () => {
      await expect(
        warehouses.create({ name: 'فرع الرياض' }, tenantA),
      ).rejects.toThrow('يوجد مخزن آخر');
    });

    it('refuses to delete a warehouse that still holds stock', async () => {
      await adjust(branch, water, 5);

      await expect(warehouses.remove(branch.id, tenantA)).rejects.toThrow(
        'به أرصدة',
      );

      await adjust(branch, water, -5);
      await warehouses.remove(branch.id, tenantA);
      expect(await warehouses.findAll(tenantA)).toHaveLength(1);
    });

    it('keeps tenants isolated', async () => {
      await expect(warehouses.findOne(main.id, tenantB)).rejects.toThrow(
        'المخزن غير موجود',
      );
      // مخزن شركة أخرى لا يقبل حركة
      await expect(
        stock.adjust(
          {
            warehouseId: main.id,
            type: StockMovementType.ADJUSTMENT,
            lines: [{ productId: water.id, quantity: 1 }],
          },
          tenantB,
        ),
      ).rejects.toThrow('المخزن غير موجود');
    });
  });

  // ─── الأرصدة ومتوسط التكلفة ─────────────────────────────────
  describe('stock and weighted average cost', () => {
    it('records an opening balance with its cost', async () => {
      const [movement] = await open(water, 100, 1.2);

      expect(movement).toMatchObject({
        type: StockMovementType.OPENING,
        quantity: 100,
        unitCost: 1.2,
        balanceAfter: 100,
      });
      expect(await quantityIn(main, water)).toBe(100);
      expect((await itemOf(water)).avgCost).toBe(1.2);
    });

    it('computes the weighted average across receipts', async () => {
      await open(water, 10, 5);
      await open(water, 10, 7);
      expect((await itemOf(water)).avgCost).toBe(6);

      // 20 بمتوسط 6 + 30 بتكلفة 8 = (120 + 240) / 50 = 7.2
      await open(water, 30, 8);
      const item = await itemOf(water);
      expect(item.avgCost).toBe(7.2);
      expect(item.lastCost).toBe(8);
    });

    it('does not change the average when stock leaves', async () => {
      await open(water, 10, 5);
      const [out] = await adjust(main, water, -4);

      expect(out.unitCost).toBe(5); // الخارج يُسعَّر بالمتوسط
      expect(out.balanceAfter).toBe(6);
      expect((await itemOf(water)).avgCost).toBe(5);
    });

    it('restarts the average when there is no stock left', async () => {
      await open(water, 10, 5);
      await adjust(main, water, -10);
      await open(water, 4, 9);

      expect((await itemOf(water)).avgCost).toBe(9);
    });

    it('forbids negative stock in the main warehouse', async () => {
      await open(water, 3, 1);

      await expect(adjust(main, water, -5)).rejects.toThrow('الرصيد غير كافٍ');
      expect(await quantityIn(main, water)).toBe(3);
    });

    it('allows negative stock in a branch', async () => {
      const [movement] = await adjust(branch, water, -2);

      expect(movement.balanceAfter).toBe(-2);
      expect(await quantityIn(branch, water)).toBe(-2);
    });

    it('rolls back every line when one fails', async () => {
      await open(water, 10, 1);

      await expect(
        stock.adjust(
          {
            warehouseId: main.id,
            type: StockMovementType.ADJUSTMENT,
            lines: [
              { productId: water.id, quantity: -4 },
              { productId: rice.id, quantity: -1 }, // لا رصيد له
            ],
          },
          tenantA,
        ),
      ).rejects.toThrow('الرصيد غير كافٍ');

      expect(await quantityIn(main, water)).toBe(10);
    });

    it('rejects service products and bad input', async () => {
      const service = await products.create(
        {
          name: 'توصيل',
          baseUnitId: water.baseUnitId,
          salePrice: 15,
          type: ProductType.SERVICE,
        },
        tenantA,
      );

      await expect(adjust(main, service, 1)).rejects.toThrow('خدمة');
      await expect(
        stock.adjust(
          {
            warehouseId: main.id,
            type: StockMovementType.OPENING,
            lines: [{ productId: water.id, quantity: -1 }],
          },
          tenantA,
        ),
      ).rejects.toThrow('الرصيد الافتتاحي');
      await expect(
        stock.adjust(
          {
            warehouseId: main.id,
            type: StockMovementType.ADJUSTMENT,
            lines: [
              { productId: water.id, quantity: 1 },
              { productId: water.id, quantity: 2 },
            ],
          },
          tenantA,
        ),
      ).rejects.toThrow('تكرار');
    });

    it('stays correct under concurrent movements', async () => {
      await open(water, 10, 1);

      const outcomes = await Promise.allSettled(
        Array.from({ length: 15 }, () => adjust(main, water, -1)),
      );

      // 10 فقط تنجح: الباقي يُرفض ولا ينزل الرصيد تحت الصفر
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(10);
      expect(await quantityIn(main, water)).toBe(0);
    });

    it('lists levels with value and alerts', async () => {
      await open(water, 10, 2);
      await adjust(branch, rice, -1);
      await stock.setMinQuantity(
        { warehouseId: main.id, productId: water.id, minQuantity: 20 },
        tenantA,
      );

      const all = await stock.findLevels(tenantA, {});
      const low = await stock.findLevels(tenantA, { alert: 'low' });
      const negative = await stock.findLevels(tenantA, { alert: 'negative' });
      const summary = await stock.summary(tenantA);

      expect(all.total).toBe(2);
      expect(low.data).toMatchObject([
        { productId: water.id, quantity: 10, value: 20, status: 'low' },
      ]);
      expect(negative.data).toMatchObject([
        { productId: rice.id, status: 'negative', value: 0 },
      ]);
      expect(summary).toMatchObject({
        items: 2,
        value: 20,
        low: 1,
        negative: 1,
      });
      expect((await stock.findLevels(tenantB, {})).total).toBe(0);
    });

    it('looks up products with their quantity in a warehouse', async () => {
      await open(water, 7, 1.5);

      const rows = await stock.lookup(tenantA, main.id, 'مياه');

      expect(rows).toMatchObject([
        { productId: water.id, quantity: 7, avgCost: 1.5 },
      ]);
    });
  });

  // ─── التحويلات ──────────────────────────────────────────────
  describe('transfers', () => {
    const newTransfer = (quantity = 6) =>
      transfers.create(
        {
          fromWarehouseId: main.id,
          toWarehouseId: branch.id,
          lines: [{ productId: water.id, quantity }],
        },
        tenantA,
      );

    beforeEach(async () => {
      await open(water, 10, 2);
    });

    it('numbers drafts sequentially without touching stock', async () => {
      const first = await newTransfer();
      const second = await newTransfer();

      expect([first.number, second.number]).toEqual(['TR-000001', 'TR-000002']);
      expect(first.status).toBe(StockTransferStatus.DRAFT);
      expect(await quantityIn(main, water)).toBe(10);
    });

    it('moves stock out on send and in on receive', async () => {
      const draft = await newTransfer(6);

      const sent = await transfers.send(draft.id, tenantA);
      expect(sent.status).toBe(StockTransferStatus.IN_TRANSIT);
      expect(sent.lines?.[0].unitCost).toBe(2);
      expect(await quantityIn(main, water)).toBe(4);
      expect(await quantityIn(branch, water)).toBe(0);
      expect((await itemOf(water)).inTransitQuantity).toBe(6);

      const received = await transfers.receive(draft.id, {}, tenantA);
      expect(received.status).toBe(StockTransferStatus.RECEIVED);
      expect(received.lines?.[0].receivedQuantity).toBe(6);
      expect(await quantityIn(branch, water)).toBe(6);
      expect((await itemOf(water)).inTransitQuantity).toBe(0);
      expect((await itemOf(water)).avgCost).toBe(2); // التحويل لا يغيّر التكلفة
    });

    it('records a shortage when less is received', async () => {
      const draft = await newTransfer(6);
      await transfers.send(draft.id, tenantA);

      const received = await transfers.receive(
        draft.id,
        { lines: [{ productId: water.id, receivedQuantity: 5 }] },
        tenantA,
      );

      expect(received.lines?.[0].receivedQuantity).toBe(5);
      expect(await quantityIn(branch, water)).toBe(5);
      expect(await quantityIn(main, water)).toBe(4);
      expect((await itemOf(water)).inTransitQuantity).toBe(0);
    });

    it('rejects receiving more than was sent', async () => {
      const draft = await newTransfer(6);
      await transfers.send(draft.id, tenantA);

      await expect(
        transfers.receive(
          draft.id,
          { lines: [{ productId: water.id, receivedQuantity: 7 }] },
          tenantA,
        ),
      ).rejects.toThrow('لا يمكن أن تتجاوز');
    });

    it('returns stock to the sender when cancelled in transit', async () => {
      const draft = await newTransfer(6);
      await transfers.send(draft.id, tenantA);

      const cancelled = await transfers.cancel(draft.id, tenantA);

      expect(cancelled.status).toBe(StockTransferStatus.CANCELLED);
      expect(await quantityIn(main, water)).toBe(10);
      expect((await itemOf(water)).inTransitQuantity).toBe(0);
    });

    it('enforces the transfer lifecycle', async () => {
      const draft = await newTransfer(6);

      await expect(transfers.receive(draft.id, {}, tenantA)).rejects.toThrow(
        'مسودة',
      );
      await transfers.send(draft.id, tenantA);
      await expect(transfers.send(draft.id, tenantA)).rejects.toThrow(
        'في الطريق',
      );
      await expect(
        transfers.update(draft.id, { note: 'x' }, tenantA),
      ).rejects.toThrow('في الطريق');
      await transfers.receive(draft.id, {}, tenantA);
      await expect(transfers.cancel(draft.id, tenantA)).rejects.toThrow(
        'مستلَم',
      );
    });

    it('sends only once under concurrent requests', async () => {
      const draft = await newTransfer(6);

      const outcomes = await Promise.allSettled([
        transfers.send(draft.id, tenantA),
        transfers.send(draft.id, tenantA),
      ]);

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(await quantityIn(main, water)).toBe(4);
    });

    it('refuses to send more than the main warehouse holds', async () => {
      const draft = await newTransfer(50);

      await expect(transfers.send(draft.id, tenantA)).rejects.toThrow(
        'الرصيد غير كافٍ',
      );
      expect((await transfers.findOne(draft.id, tenantA)).status).toBe(
        StockTransferStatus.DRAFT,
      );
    });

    it('counts goods in transit in the weighted average', async () => {
      const draft = await newTransfer(10); // كل الرصيد في الطريق
      await transfers.send(draft.id, tenantA);

      // 10 في الطريق بتكلفة 2 + 10 جديدة بتكلفة 4 = متوسط 3
      await open(water, 10, 4);

      expect((await itemOf(water)).avgCost).toBe(3);
    });

    it('validates warehouses and tenant ownership', async () => {
      await expect(
        transfers.create(
          {
            fromWarehouseId: main.id,
            toWarehouseId: main.id,
            lines: [{ productId: water.id, quantity: 1 }],
          },
          tenantA,
        ),
      ).rejects.toThrow('مخزنين مختلفين');

      const draft = await newTransfer();
      await expect(transfers.findOne(draft.id, tenantB)).rejects.toThrow(
        'التحويل غير موجود',
      );
      await expect(transfers.send(draft.id, tenantB)).rejects.toThrow(
        'التحويل غير موجود',
      );
    });

    it('blocks deleting a warehouse with an open transfer', async () => {
      await newTransfer();

      await expect(warehouses.remove(branch.id, tenantA)).rejects.toThrow(
        'تحويل لم يكتمل',
      );
    });
  });

  // ─── الجرد ──────────────────────────────────────────────────
  describe('stocktakes', () => {
    beforeEach(async () => {
      await open(water, 10, 2);
      await open(rice, 5, 30);
    });

    const newStocktake = (waterCount: number, riceCount: number) =>
      stocktakes.create(
        {
          warehouseId: main.id,
          lines: [
            { productId: water.id, countedQuantity: waterCount },
            { productId: rice.id, countedQuantity: riceCount },
          ],
        },
        tenantA,
      );

    it('shows the system quantity on a draft without changing stock', async () => {
      const draft = await newStocktake(8, 5);

      expect(draft.number).toBe('ST-000001');
      expect(draft.lines?.find((l) => l.productId === water.id)).toMatchObject({
        countedQuantity: 8,
        currentQuantity: 10,
      });
      expect(await quantityIn(main, water)).toBe(10);
    });

    it('sets stock to the counted quantity when posted', async () => {
      const draft = await newStocktake(8, 5);

      const posted = await stocktakes.post(draft.id, tenantA);

      expect(posted.status).toBe(StocktakeStatus.POSTED);
      expect(posted.lines?.find((l) => l.productId === water.id)).toMatchObject(
        {
          countedQuantity: 8,
          expectedQuantity: 10,
          unitCost: 2,
        },
      );
      expect(await quantityIn(main, water)).toBe(8);

      // الصنف المطابق لا تُكتب له حركة
      const movements = await stock.findMovements(tenantA, {
        type: StockMovementType.STOCKTAKE,
      });
      expect(movements.data).toMatchObject([
        { productId: water.id, quantity: -2, balanceAfter: 8 },
      ]);
      expect((await itemOf(water)).avgCost).toBe(2);
    });

    it('uses the quantity at posting time, not at draft time', async () => {
      const draft = await newStocktake(8, 5);
      await adjust(main, water, -3); // حركة بعد إنشاء المسودة: الرصيد 7

      const posted = await stocktakes.post(draft.id, tenantA);

      expect(
        posted.lines?.find((l) => l.productId === water.id)?.expectedQuantity,
      ).toBe(7);
      expect(await quantityIn(main, water)).toBe(8);
    });

    it('enforces the stocktake lifecycle', async () => {
      const draft = await newStocktake(8, 5);
      await stocktakes.post(draft.id, tenantA);

      await expect(stocktakes.post(draft.id, tenantA)).rejects.toThrow('معتمد');
      await expect(stocktakes.cancel(draft.id, tenantA)).rejects.toThrow(
        'معتمد',
      );
      await expect(stocktakes.findOne(draft.id, tenantB)).rejects.toThrow(
        'الجرد غير موجود',
      );
    });

    it('cancels a draft without touching stock', async () => {
      const draft = await newStocktake(0, 0);

      const cancelled = await stocktakes.cancel(draft.id, tenantA);

      expect(cancelled.status).toBe(StocktakeStatus.CANCELLED);
      expect(await quantityIn(main, water)).toBe(10);
    });
  });
});
