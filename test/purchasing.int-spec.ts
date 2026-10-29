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
import {
  StockMovement,
  StockMovementType,
} from '../src/modules/inventory/entities/stock-movement.entity';
import { StockTransfer } from '../src/modules/inventory/entities/stock-transfer.entity';
import { Warehouse } from '../src/modules/inventory/entities/warehouse.entity';
import { StockService } from '../src/modules/inventory/stock.service';
import { WarehousesService } from '../src/modules/inventory/warehouses.service';
import { PurchaseLineDto } from '../src/modules/purchasing/dto/purchasing.dto';
import {
  PurchaseInvoice,
  PurchaseInvoiceStatus,
} from '../src/modules/purchasing/entities/purchase-invoice.entity';
import {
  PurchaseReturn,
  PurchaseReturnStatus,
} from '../src/modules/purchasing/entities/purchase-return.entity';
import {
  SupplierPayment,
  SupplierPaymentStatus,
} from '../src/modules/purchasing/entities/supplier-payment.entity';
import { Supplier } from '../src/modules/purchasing/entities/supplier.entity';
import { PurchaseInvoicesService } from '../src/modules/purchasing/purchase-invoices.service';
import { PurchaseReturnsService } from '../src/modules/purchasing/purchase-returns.service';
import { SupplierPaymentsService } from '../src/modules/purchasing/supplier-payments.service';
import { SuppliersService } from '../src/modules/purchasing/suppliers.service';
import { Tenant } from '../src/modules/tenants/entities/tenant.entity';
import { createTestDataSource, truncateAllTables } from './utils/test-database';
import { createFilesService } from './utils/files';

const TODAY = '2026-10-12';

describe('purchasing module', () => {
  let dataSource: DataSource;
  let settings: CatalogSettingsService;
  let products: ProductsService;
  let warehouses: WarehousesService;
  let stock: StockService;
  let suppliers: SuppliersService;
  let invoices: PurchaseInvoicesService;
  let returns: PurchaseReturnsService;
  let payments: SupplierPaymentsService;

  let tenantA: string;
  let tenantB: string;
  let main: Warehouse;
  let supplier: Supplier;
  let piece: Unit;
  let carton: Unit;
  let water: Product;
  let rice: Product;

  const quantityOf = async (product: Product) =>
    (await stock.getQuantities(tenantA, main.id, [product.id])).get(
      product.id,
    ) ?? 0;

  const avgCostOf = async (product: Product) =>
    (
      await dataSource
        .getRepository(InventoryItem)
        .findOneByOrFail({ tenantId: tenantA, productId: product.id })
    ).avgCost;

  const balanceOf = async () =>
    (await suppliers.findOne(supplier.id, tenantA)).balance;

  const newInvoice = (
    lines: PurchaseLineDto[],
    overrides: { pricesIncludeTax?: boolean; dueDate?: string } = {},
  ) =>
    invoices.create(
      {
        supplierId: supplier.id,
        warehouseId: main.id,
        invoiceDate: TODAY,
        lines,
        ...overrides,
      },
      tenantA,
    );

  /** فاتورة معتمدة: 10 مياه بسعر 20 + ضريبة 15% = 230 */
  const postedInvoice = async () => {
    const draft = await newInvoice([
      { productId: water.id, quantity: 10, unitPrice: 20 },
    ]);
    return invoices.post(draft.id, tenantA);
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
      createFilesService(dataSource),
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
    suppliers = new SuppliersService(
      dataSource.getRepository(Supplier),
      dataSource,
    );
    invoices = new PurchaseInvoicesService(
      dataSource.getRepository(PurchaseInvoice),
      suppliers,
      warehouses,
      products,
      settings,
      stock,
      dataSource,
    );
    returns = new PurchaseReturnsService(
      dataSource.getRepository(PurchaseReturn),
      invoices,
      stock,
      dataSource,
    );
    payments = new SupplierPaymentsService(
      dataSource.getRepository(SupplierPayment),
      suppliers,
      invoices,
      dataSource,
    );
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    const tenants = dataSource.getRepository(Tenant);
    tenantA = (await tenants.save({ companyName: 'شركة أ' })).id;
    tenantB = (await tenants.save({ companyName: 'شركة ب' })).id;

    main = await warehouses.getMain(tenantA);
    supplier = await suppliers.create(
      { name: 'مؤسسة التوريد', paymentTermsDays: 30 },
      tenantA,
    );

    const units = await settings.findUnits(tenantA);
    piece = units.find((u) => u.name === 'قطعة')!;
    carton = units.find((u) => u.name === 'كرتون')!;
    water = await products.create(
      {
        name: 'مياه 330 مل',
        baseUnitId: piece.id,
        salePrice: 2,
        units: [{ unitId: carton.id, factor: 24 }],
      },
      tenantA,
    );
    rice = await products.create(
      { name: 'أرز 5 كجم', baseUnitId: piece.id, salePrice: 48 },
      tenantA,
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  // ─── الموردون ───────────────────────────────────────────────
  describe('suppliers', () => {
    it('generates sequential codes and starts with the opening balance', async () => {
      const second = await suppliers.create(
        { name: 'مورد ثانٍ', openingBalance: 500 },
        tenantA,
      );

      expect(supplier.code).toBe('SUP-000001');
      expect(second.code).toBe('SUP-000002');
      expect(second.balance).toBe(500);
    });

    it('rejects a duplicate name and isolates tenants', async () => {
      await expect(
        suppliers.create({ name: 'مؤسسة التوريد' }, tenantA),
      ).rejects.toThrow('يوجد مورد آخر');
      // نفس الاسم مسموح لشركة أخرى
      await suppliers.create({ name: 'مؤسسة التوريد' }, tenantB);

      await expect(suppliers.findOne(supplier.id, tenantB)).rejects.toThrow(
        'المورد غير موجود',
      );
      expect((await suppliers.findAll(tenantB, {})).total).toBe(1);
    });

    it('deletes only suppliers without documents', async () => {
      await postedInvoice();
      await expect(suppliers.remove(supplier.id, tenantA)).rejects.toThrow(
        'لا يمكن حذف مورد',
      );

      const unused = await suppliers.create({ name: 'بلا مستندات' }, tenantA);
      await suppliers.remove(unused.id, tenantA);
      expect((await suppliers.findAll(tenantA, {})).total).toBe(1);
    });

    it('refuses new invoices for an inactive supplier', async () => {
      await suppliers.update(supplier.id, { isActive: false }, tenantA);

      await expect(
        newInvoice([{ productId: water.id, quantity: 1, unitPrice: 1 }]),
      ).rejects.toThrow('موقوف');
    });
  });

  // ─── فواتير الشراء ──────────────────────────────────────────
  describe('purchase invoices', () => {
    it('computes totals on a draft without touching stock or balance', async () => {
      const draft = await newInvoice([
        { productId: water.id, quantity: 10, unitPrice: 20 },
        { productId: rice.id, quantity: 2, unitPrice: 30, discount: 10 },
      ]);

      expect(draft).toMatchObject({
        number: 'PI-000001',
        status: PurchaseInvoiceStatus.DRAFT,
        subtotal: 250,
        discountTotal: 10,
        taxTotal: 37.5,
        total: 287.5,
        dueDate: '2026-11-11', // تاريخ الفاتورة + مهلة المورد 30 يوماً
      });
      expect(await quantityOf(water)).toBe(0);
      expect(await balanceOf()).toBe(0);
    });

    it('receives stock at cost and owes the supplier when posted', async () => {
      const posted = await postedInvoice();

      expect(posted).toMatchObject({
        status: PurchaseInvoiceStatus.POSTED,
        total: 230,
        remaining: 230,
        paymentStatus: 'unpaid',
      });
      expect(await quantityOf(water)).toBe(10);
      expect(await avgCostOf(water)).toBe(20); // التكلفة قبل الضريبة
      expect(await balanceOf()).toBe(230);

      const movements = await stock.findMovements(tenantA, {
        type: StockMovementType.PURCHASE,
      });
      expect(movements.data).toMatchObject([
        { quantity: 10, unitCost: 20, referenceId: posted.id },
      ]);
    });

    it('adds purchase VAT to cost for a business not registered for VAT', async () => {
      await dataSource.query(
        `INSERT INTO sales_settings ("tenantId", "vatRegistered") VALUES ($1, false)`,
        [tenantA],
      );

      const posted = await postedInvoice();

      // المورد ما زال يستحق 230 (حصّل الضريبة)، لكنها لا تُسترد: التكلفة 23
      expect(posted).toMatchObject({ total: 230, remaining: 230 });
      expect(await avgCostOf(water)).toBe(23);
      expect(posted.lines?.[0]).toMatchObject({ unitCost: 23 });
      expect(
        (
          await stock.findMovements(tenantA, {
            type: StockMovementType.PURCHASE,
          })
        ).data,
      ).toMatchObject([{ quantity: 10, unitCost: 23 }]);
    });

    it('converts purchase units to base units', async () => {
      // 5 كراتين × 24 قطعة، الكرتون بـ 36 → القطعة بـ 1.5
      const draft = await newInvoice([
        { productId: water.id, unitId: carton.id, quantity: 5, unitPrice: 36 },
      ]);
      await invoices.post(draft.id, tenantA);

      expect(draft.lines?.[0]).toMatchObject({
        factor: 24,
        baseQuantity: 120,
        unitCost: 1.5,
      });
      expect(await quantityOf(water)).toBe(120);
      expect(await avgCostOf(water)).toBe(1.5);
    });

    it('extracts tax from tax-inclusive prices', async () => {
      const draft = await newInvoice(
        [{ productId: water.id, quantity: 10, unitPrice: 23 }],
        { pricesIncludeTax: true },
      );

      expect(draft).toMatchObject({ subtotal: 200, taxTotal: 30, total: 230 });
      expect(draft.lines?.[0].unitCost).toBe(20);
    });

    it('blends cost into the weighted average across invoices', async () => {
      await postedInvoice(); // 10 بتكلفة 20
      const second = await newInvoice([
        { productId: water.id, quantity: 30, unitPrice: 24 },
      ]);
      await invoices.post(second.id, tenantA);

      expect(await avgCostOf(water)).toBe(23); // (200 + 720) / 40
    });

    it('recalculates everything when a draft is edited', async () => {
      const draft = await newInvoice([
        { productId: water.id, quantity: 10, unitPrice: 20 },
      ]);

      const inclusive = await invoices.update(
        draft.id,
        { pricesIncludeTax: true },
        tenantA,
      );
      expect(inclusive.total).toBe(200);

      const replaced = await invoices.update(
        draft.id,
        { lines: [{ productId: rice.id, quantity: 1, unitPrice: 115 }] },
        tenantA,
      );
      expect(replaced.lines).toHaveLength(1);
      expect(replaced).toMatchObject({ subtotal: 100, total: 115 });
    });

    it('validates units, discounts, products and tenant ownership', async () => {
      await expect(
        newInvoice([
          {
            productId: rice.id,
            unitId: carton.id, // الأرز ليس له وحدة كرتون
            quantity: 1,
            unitPrice: 1,
          },
        ]),
      ).rejects.toThrow('ليست من وحدات الصنف');
      await expect(
        newInvoice([
          { productId: water.id, quantity: 1, unitPrice: 5, discount: 6 },
        ]),
      ).rejects.toThrow('أكبر من قيمته');

      const foreign = await suppliers.create({ name: 'مورد ب' }, tenantB);
      await expect(
        invoices.create(
          {
            supplierId: foreign.id,
            warehouseId: main.id,
            invoiceDate: TODAY,
            lines: [{ productId: water.id, quantity: 1, unitPrice: 1 }],
          },
          tenantA,
        ),
      ).rejects.toThrow('المورد غير موجود');

      const draft = await newInvoice([
        { productId: water.id, quantity: 1, unitPrice: 1 },
      ]);
      await expect(invoices.findOne(draft.id, tenantB)).rejects.toThrow(
        'فاتورة الشراء غير موجودة',
      );
      await expect(invoices.post(draft.id, tenantB)).rejects.toThrow(
        'فاتورة الشراء غير موجودة',
      );
    });

    it('enforces the invoice lifecycle', async () => {
      const posted = await postedInvoice();

      await expect(invoices.post(posted.id, tenantA)).rejects.toThrow('معتمدة');
      await expect(
        invoices.update(posted.id, { note: 'x' }, tenantA),
      ).rejects.toThrow('معتمدة');
    });

    it('posts only once under concurrent requests', async () => {
      const draft = await newInvoice([
        { productId: water.id, quantity: 10, unitPrice: 20 },
      ]);

      const outcomes = await Promise.allSettled([
        invoices.post(draft.id, tenantA),
        invoices.post(draft.id, tenantA),
      ]);

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(await quantityOf(water)).toBe(10);
    });

    it('cancels a posted invoice by taking its stock back out', async () => {
      const posted = await postedInvoice();

      const cancelled = await invoices.cancel(posted.id, tenantA);

      expect(cancelled.status).toBe(PurchaseInvoiceStatus.CANCELLED);
      expect(await quantityOf(water)).toBe(0);
      expect(await balanceOf()).toBe(0);
    });

    it('refuses to cancel an invoice that has a payment', async () => {
      const posted = await postedInvoice();
      await payments.create(
        {
          supplierId: supplier.id,
          invoiceId: posted.id,
          paymentDate: TODAY,
          amount: 50,
        },
        tenantA,
      );

      await expect(invoices.cancel(posted.id, tenantA)).rejects.toThrow(
        'عليها سداد أو مرتجع',
      );
    });

    it('filters invoices that are due or overdue', async () => {
      await postedInvoice(); // تستحق بعد 30 يوماً
      const old = await newInvoice(
        [{ productId: rice.id, quantity: 1, unitPrice: 100 }],
        { dueDate: '2020-01-01' },
      );
      await invoices.post(old.id, tenantA);
      await newInvoice([{ productId: rice.id, quantity: 1, unitPrice: 1 }]);

      const due = await invoices.findAll(tenantA, { payment: 'due' });
      const overdue = await invoices.findAll(tenantA, { payment: 'overdue' });
      const summary = await suppliers.summary(tenantA);

      expect(due.total).toBe(2);
      expect(overdue.data.map((i) => i.id)).toEqual([old.id]);
      expect(summary).toMatchObject({
        payables: 345,
        overdue: 115,
        draftInvoices: 1,
      });
    });
  });

  // ─── السداد ─────────────────────────────────────────────────
  describe('supplier payments', () => {
    it('pays an invoice partially then fully', async () => {
      const invoice = await postedInvoice();
      const pay = (amount: number) =>
        payments.create(
          {
            supplierId: supplier.id,
            invoiceId: invoice.id,
            paymentDate: TODAY,
            amount,
          },
          tenantA,
        );

      const first = await pay(100);
      expect(first.number).toBe('SP-000001');
      expect(await invoices.findOne(invoice.id, tenantA)).toMatchObject({
        paidAmount: 100,
        remaining: 130,
        paymentStatus: 'partial',
      });

      await pay(130);
      expect(await invoices.findOne(invoice.id, tenantA)).toMatchObject({
        remaining: 0,
        paymentStatus: 'paid',
      });
      expect(await balanceOf()).toBe(0);
    });

    it('rejects paying more than the invoice remaining', async () => {
      const invoice = await postedInvoice();

      await expect(
        payments.create(
          {
            supplierId: supplier.id,
            invoiceId: invoice.id,
            paymentDate: TODAY,
            amount: 230.01,
          },
          tenantA,
        ),
      ).rejects.toThrow('أكبر من المتبقي');
    });

    it('never overpays under concurrent payments', async () => {
      const invoice = await postedInvoice();

      const outcomes = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          payments.create(
            {
              supplierId: supplier.id,
              invoiceId: invoice.id,
              paymentDate: TODAY,
              amount: 100,
            },
            tenantA,
          ),
        ),
      );

      // 230 تتحمل دفعتين بـ 100 فقط
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(2);
      expect((await invoices.findOne(invoice.id, tenantA)).paidAmount).toBe(
        200,
      );
    });

    it('records a payment on account without an invoice', async () => {
      await postedInvoice();

      await payments.create(
        { supplierId: supplier.id, paymentDate: TODAY, amount: 30 },
        tenantA,
      );

      expect(await balanceOf()).toBe(200);
    });

    it('restores the amount when a payment is cancelled', async () => {
      const invoice = await postedInvoice();
      const payment = await payments.create(
        {
          supplierId: supplier.id,
          invoiceId: invoice.id,
          paymentDate: TODAY,
          amount: 100,
        },
        tenantA,
      );

      const cancelled = await payments.cancel(payment.id, tenantA);

      expect(cancelled.status).toBe(SupplierPaymentStatus.CANCELLED);
      expect((await invoices.findOne(invoice.id, tenantA)).remaining).toBe(230);
      expect(await balanceOf()).toBe(230);
      await expect(payments.cancel(payment.id, tenantA)).rejects.toThrow(
        'ملغي بالفعل',
      );
    });

    it('rejects an invoice of another supplier or tenant', async () => {
      const invoice = await postedInvoice();
      const other = await suppliers.create({ name: 'مورد آخر' }, tenantA);

      await expect(
        payments.create(
          {
            supplierId: other.id,
            invoiceId: invoice.id,
            paymentDate: TODAY,
            amount: 10,
          },
          tenantA,
        ),
      ).rejects.toThrow('ليست لهذا المورد');
      await expect(
        payments.create(
          {
            supplierId: supplier.id,
            invoiceId: invoice.id,
            paymentDate: TODAY,
            amount: 10,
          },
          tenantB,
        ),
      ).rejects.toThrow('المورد غير موجود');
    });
  });

  // ─── المرتجعات ──────────────────────────────────────────────
  describe('purchase returns', () => {
    const newReturn = async (invoice: PurchaseInvoice, quantity: number) =>
      returns.create(
        {
          invoiceId: invoice.id,
          returnDate: TODAY,
          reason: 'تالف',
          lines: [{ invoiceLineId: invoice.lines![0].id, quantity }],
        },
        tenantA,
      );

    it('returns goods: stock out, balance down, invoice updated', async () => {
      const invoice = await postedInvoice();
      const draft = await newReturn(invoice, 4);

      expect(draft).toMatchObject({
        number: 'PR-000001',
        status: PurchaseReturnStatus.DRAFT,
        subtotal: 80,
        taxTotal: 12,
        total: 92,
      });
      expect(await quantityOf(water)).toBe(10); // المسودة لا تغيّر شيئاً

      const posted = await returns.post(draft.id, tenantA);
      const after = await invoices.findOne(invoice.id, tenantA);

      expect(posted.status).toBe(PurchaseReturnStatus.POSTED);
      expect(await quantityOf(water)).toBe(6);
      expect(await balanceOf()).toBe(138);
      expect(after).toMatchObject({ returnedAmount: 92, remaining: 138 });
      expect(after.lines?.[0].returnedQuantity).toBe(4);
    });

    it('converts returned purchase units to base units', async () => {
      const draft = await newInvoice([
        { productId: water.id, unitId: carton.id, quantity: 5, unitPrice: 36 },
      ]);
      const invoice = await invoices.post(draft.id, tenantA);

      const ret = await newReturn(invoice, 2); // كرتونان = 48 قطعة
      await returns.post(ret.id, tenantA);

      expect(await quantityOf(water)).toBe(72);
    });

    it('never returns more than was bought, even across returns', async () => {
      const invoice = await postedInvoice();
      await expect(newReturn(invoice, 11)).rejects.toThrow(
        'أكبر من المتاح للإرجاع',
      );

      const first = await newReturn(invoice, 6);
      const second = await newReturn(invoice, 6); // مسودتان مجموعهما 12 > 10
      await returns.post(first.id, tenantA);

      await expect(returns.post(second.id, tenantA)).rejects.toThrow(
        'أكبر من المتاح للإرجاع (4)',
      );
      expect(await quantityOf(water)).toBe(4);
    });

    it('only returns from posted invoices and enforces its lifecycle', async () => {
      const draftInvoice = await newInvoice([
        { productId: water.id, quantity: 1, unitPrice: 1 },
      ]);
      await expect(newReturn(draftInvoice, 1)).rejects.toThrow(
        'فاتورة شراء معتمدة',
      );

      const invoice = await postedInvoice();
      const ret = await newReturn(invoice, 1);
      await returns.post(ret.id, tenantA);

      await expect(returns.post(ret.id, tenantA)).rejects.toThrow('معتمد');
      await expect(returns.cancel(ret.id, tenantA)).rejects.toThrow('معتمد');
      await expect(returns.findOne(ret.id, tenantB)).rejects.toThrow(
        'المرتجع غير موجود',
      );
    });

    it('leaves the supplier owing us when a paid invoice is returned', async () => {
      const invoice = await postedInvoice();
      await payments.create(
        {
          supplierId: supplier.id,
          invoiceId: invoice.id,
          paymentDate: TODAY,
          amount: 230,
        },
        tenantA,
      );
      const ret = await newReturn(invoice, 10);
      await returns.post(ret.id, tenantA);

      expect(await balanceOf()).toBe(-230); // رصيد دائن لنا عند المورد
      expect((await invoices.findOne(invoice.id, tenantA)).remaining).toBe(0);
    });
  });

  // ─── كشف الحساب ─────────────────────────────────────────────
  describe('supplier statement', () => {
    it('lists every entry with a running balance', async () => {
      await suppliers.update(supplier.id, { openingBalance: 100 }, tenantA);
      const invoice = await postedInvoice();
      await payments.create(
        {
          supplierId: supplier.id,
          invoiceId: invoice.id,
          paymentDate: TODAY,
          amount: 130,
        },
        tenantA,
      );
      const ret = await returns.create(
        {
          invoiceId: invoice.id,
          returnDate: TODAY,
          lines: [{ invoiceLineId: invoice.lines![0].id, quantity: 1 }],
        },
        tenantA,
      );
      await returns.post(ret.id, tenantA);

      const statement = await suppliers.statement(supplier.id, tenantA);

      expect(statement.openingBalance).toBe(100);
      expect(
        statement.entries.map((e) => [e.type, e.credit, e.debit, e.balance]),
      ).toEqual([
        ['invoice', 230, 0, 330],
        ['payment', 0, 130, 200],
        ['return', 0, 23, 177],
      ]);
      expect(statement).toMatchObject({
        totalCredit: 230,
        totalDebit: 153,
        closingBalance: 177,
      });
      expect(await balanceOf()).toBe(177);
    });

    it('rolls earlier entries into the opening balance of a period', async () => {
      await postedInvoice();

      const later = await suppliers.statement(supplier.id, tenantA, {
        from: '2026-11-01',
      });

      expect(later.openingBalance).toBe(230);
      expect(later.entries).toHaveLength(0);
      expect(later.closingBalance).toBe(230);
    });
  });

  // ─── عملات الثلاث خانات (الدينار، الريال العُماني) ───────────────
  describe('three-decimal currencies', () => {
    /** 3 × 1.125 بضريبة 15%: الفلس الثالث يضيع إن قُرِّب لخانتين */
    const filsLine = (): PurchaseLineDto[] => [
      { productId: water.id, quantity: 3, unitPrice: 1.125 },
    ];

    const useDinar = () =>
      dataSource
        .getRepository(Tenant)
        .update({ id: tenantA }, { country: 'KW', currency: 'KWD' });

    it('rounds a riyal invoice to two decimals', async () => {
      const invoice = await newInvoice(filsLine());

      expect(invoice).toMatchObject({
        subtotal: 3.38,
        taxTotal: 0.51,
        total: 3.89,
      });
    });

    it('keeps fils through invoice, payment and return for a dinar company', async () => {
      await useDinar();

      const draft = await newInvoice(filsLine());
      expect(draft).toMatchObject({
        subtotal: 3.375,
        taxTotal: 0.506,
        total: 3.881,
      });

      const posted = await invoices.post(draft.id, tenantA);
      expect(await balanceOf()).toBe(3.881);

      await payments.create(
        {
          supplierId: supplier.id,
          invoiceId: posted.id,
          paymentDate: TODAY,
          amount: 1.881,
        },
        tenantA,
      );
      expect(await invoices.findOne(posted.id, tenantA)).toMatchObject({
        paidAmount: 1.881,
        remaining: 2,
      });

      const ret = await returns.create(
        {
          invoiceId: posted.id,
          returnDate: TODAY,
          lines: [{ invoiceLineId: posted.lines![0].id, quantity: 1 }],
        },
        tenantA,
      );
      expect(ret).toMatchObject({
        subtotal: 1.125,
        taxTotal: 0.169,
        total: 1.294,
      });
    });
  });
});
