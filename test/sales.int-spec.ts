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
import { StockTransfer } from '../src/modules/inventory/entities/stock-transfer.entity';
import { Warehouse } from '../src/modules/inventory/entities/warehouse.entity';
import { StockService } from '../src/modules/inventory/stock.service';
import { WarehousesService } from '../src/modules/inventory/warehouses.service';
import { CustomerPaymentsService } from '../src/modules/sales/customer-payments.service';
import { CustomersService } from '../src/modules/sales/customers.service';
import { SalesLineDto, TenderDto } from '../src/modules/sales/dto/sales.dto';
import {
  CustomerPayment,
  CustomerPaymentStatus,
  PaymentDirection,
  SalesPaymentMethod,
} from '../src/modules/sales/entities/customer-payment.entity';
import { Customer } from '../src/modules/sales/entities/customer.entity';
import {
  SalesInvoice,
  SalesInvoiceStatus,
  SalesInvoiceType,
} from '../src/modules/sales/entities/sales-invoice.entity';
import {
  SalesReturn,
  SalesReturnStatus,
} from '../src/modules/sales/entities/sales-return.entity';
import { SalesSettings } from '../src/modules/sales/entities/sales-settings.entity';
import { SalesInvoicesService } from '../src/modules/sales/sales-invoices.service';
import { SalesReturnsService } from '../src/modules/sales/sales-returns.service';
import { SalesSettingsService } from '../src/modules/sales/sales-settings.service';
import {
  computeInvoiceHash,
  parseZatcaQr,
} from '../src/modules/sales/utils/zatca.util';
import { Tenant } from '../src/modules/tenants/entities/tenant.entity';
import { createTestDataSource, truncateAllTables } from './utils/test-database';

const TODAY = '2026-10-12';
const CASH = SalesPaymentMethod.CASH;

describe('sales module', () => {
  let dataSource: DataSource;
  let settings: CatalogSettingsService;
  let products: ProductsService;
  let warehouses: WarehousesService;
  let stock: StockService;
  let customers: CustomersService;
  let salesSettings: SalesSettingsService;
  let invoices: SalesInvoicesService;
  let returns: SalesReturnsService;
  let payments: CustomerPaymentsService;

  let tenantA: string;
  let tenantB: string;
  let main: Warehouse;
  let branch: Warehouse;
  let customer: Customer;
  let piece: Unit;
  let carton: Unit;
  /** مياه: سعر القطعة 2.30 شامل الضريبة، تكلفتها 1 */
  let water: Product;
  let delivery: Product;

  const quantityIn = async (warehouse: Warehouse, product: Product) =>
    (await stock.getQuantities(tenantA, warehouse.id, [product.id])).get(
      product.id,
    ) ?? 0;

  const balanceOf = async () =>
    (await customers.findOne(customer.id, tenantA)).balance;

  const newInvoice = (
    lines: SalesLineDto[],
    overrides: {
      customerId?: string | null;
      warehouseId?: string;
      pricesIncludeTax?: boolean;
      uuid?: string;
    } = {},
  ) =>
    invoices.create(
      {
        customerId: customer.id,
        warehouseId: main.id,
        invoiceDate: TODAY,
        lines,
        ...overrides,
      },
      tenantA,
    );

  /** فاتورة آجلة صادرة: 10 مياه × 2.30 = 23 شامل الضريبة */
  const issuedInvoice = async (payments: TenderDto[] = []) => {
    const draft = await newInvoice([
      { productId: water.id, quantity: 10, unitPrice: 2.3 },
    ]);
    return invoices.issue(draft.id, { payments }, tenantA);
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
    salesSettings = new SalesSettingsService(
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
    returns = new SalesReturnsService(
      dataSource.getRepository(SalesReturn),
      invoices,
      stock,
      dataSource,
    );
    payments = new CustomerPaymentsService(
      dataSource.getRepository(CustomerPayment),
      customers,
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
    branch = await warehouses.create({ name: 'فرع العليا' }, tenantA);
    customer = await customers.create(
      { name: 'مطعم الريف', paymentTermsDays: 15 },
      tenantA,
    );

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
      },
      tenantA,
    );
    delivery = await products.create(
      {
        name: 'خدمة توصيل',
        baseUnitId: piece.id,
        salePrice: 11.5,
        type: ProductType.SERVICE,
      },
      tenantA,
    );

    // 100 قطعة مياه في الرئيسي بتكلفة 1
    await stock.adjust(
      {
        warehouseId: main.id,
        type: StockMovementType.OPENING,
        lines: [{ productId: water.id, quantity: 100, unitCost: 1 }],
      },
      tenantA,
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  // ─── العملاء ────────────────────────────────────────────────
  describe('customers', () => {
    it('generates sequential codes and isolates tenants', async () => {
      const second = await customers.create(
        { name: 'عميل ثانٍ', openingBalance: 300 },
        tenantA,
      );

      expect(customer.code).toBe('CUS-000001');
      expect(second).toMatchObject({ code: 'CUS-000002', balance: 300 });
      await expect(customers.findOne(customer.id, tenantB)).rejects.toThrow(
        'العميل غير موجود',
      );
      expect((await customers.findAll(tenantB, {})).total).toBe(0);
    });

    it('deletes only customers without documents', async () => {
      await issuedInvoice();
      await expect(customers.remove(customer.id, tenantA)).rejects.toThrow(
        'لا يمكن حذف عميل',
      );

      const unused = await customers.create({ name: 'بلا مستندات' }, tenantA);
      await customers.remove(unused.id, tenantA);
      expect((await customers.findAll(tenantA, {})).total).toBe(1);
    });
  });

  // ─── المسودة ────────────────────────────────────────────────
  describe('draft invoices', () => {
    it('computes tax-inclusive totals with no number, stock or balance effect', async () => {
      const draft = await newInvoice([
        { productId: water.id, quantity: 10, unitPrice: 2.3 },
        { productId: delivery.id, quantity: 1, unitPrice: 11.5 },
      ]);

      expect(draft).toMatchObject({
        number: null,
        status: SalesInvoiceStatus.DRAFT,
        invoiceType: SalesInvoiceType.SIMPLIFIED,
        subtotal: 30,
        taxTotal: 4.5,
        total: 34.5,
        dueDate: '2026-10-27', // + مهلة العميل 15 يوماً
      });
      expect(draft.lines?.map((l) => l.isStocked)).toEqual([true, false]);
      expect(await quantityIn(main, water)).toBe(100);
      expect(await balanceOf()).toBe(0);
    });

    it('is idempotent on the client uuid', async () => {
      const uuid = '3f0c2b1e-0000-4000-8000-000000000001';
      const lines = [{ productId: water.id, quantity: 1, unitPrice: 2.3 }];

      const first = await newInvoice(lines, { uuid });
      const again = await newInvoice(lines, { uuid });

      expect(again.id).toBe(first.id);
      expect((await invoices.findAll(tenantA, {})).total).toBe(1);
    });

    it('marks invoices of VAT-registered customers as standard', async () => {
      await customers.update(
        customer.id,
        { taxNumber: '310000000000003' },
        tenantA,
      );

      const draft = await newInvoice([
        { productId: water.id, quantity: 1, unitPrice: 2.3 },
      ]);

      expect(draft.invoiceType).toBe(SalesInvoiceType.STANDARD);
    });

    it('enforces the product pricing rules', async () => {
      // أقل سعر 2: بيع 10 بـ 2.30 مع خصم 4 = 1.90 للقطعة
      await expect(
        newInvoice([
          { productId: water.id, quantity: 10, unitPrice: 2.3, discount: 4 },
        ]),
      ).rejects.toThrow('أقل من أقل سعر مسموح');
      // نفس القاعدة على الكرتون: 24 قطعة بـ 40 = 1.67 للقطعة
      await expect(
        newInvoice([
          {
            productId: water.id,
            unitId: carton.id,
            quantity: 1,
            unitPrice: 40,
          },
        ]),
      ).rejects.toThrow('أقل من أقل سعر مسموح');

      await products.update(water.id, { allowDiscount: false }, tenantA);
      await expect(
        newInvoice([
          { productId: water.id, quantity: 10, unitPrice: 2.3, discount: 1 },
        ]),
      ).rejects.toThrow('لا يُسمح بالخصم');
    });

    it('compares the minimum price on the same tax basis', async () => {
      // الصنف سعره شامل الضريبة (أقل سعر 2 شامل). فاتورة أسعارها قبل الضريبة:
      // 1.80 قبل الضريبة = 2.07 شامل ← مقبول؛ 1.70 = 1.955 شامل ← مرفوض
      const ok = await newInvoice(
        [{ productId: water.id, quantity: 10, unitPrice: 1.8 }],
        { pricesIncludeTax: false },
      );
      expect(ok.total).toBe(20.7);

      await expect(
        newInvoice([{ productId: water.id, quantity: 10, unitPrice: 1.7 }], {
          pricesIncludeTax: false,
        }),
      ).rejects.toThrow('أقل من أقل سعر مسموح');
    });

    it('cancels a draft, and only a draft', async () => {
      const draft = await newInvoice([
        { productId: water.id, quantity: 1, unitPrice: 2.3 },
      ]);
      expect((await invoices.cancel(draft.id, tenantA)).status).toBe(
        SalesInvoiceStatus.CANCELLED,
      );

      const issued = await issuedInvoice();
      await expect(invoices.cancel(issued.id, tenantA)).rejects.toThrow(
        'الصادرة لا تُلغى',
      );
      await expect(
        invoices.update(issued.id, { note: 'x' }, tenantA),
      ).rejects.toThrow('صادرة');
    });
  });

  // ─── الإصدار ────────────────────────────────────────────────
  describe('issuing', () => {
    it('numbers the invoice, moves stock at cost and charges the customer', async () => {
      const issued = await issuedInvoice();

      expect(issued).toMatchObject({
        number: 'INV-000001',
        counter: 1,
        status: SalesInvoiceStatus.ISSUED,
        total: 23,
        costTotal: 10, // 10 قطع × تكلفة 1
        remaining: 23,
        paymentStatus: 'unpaid',
      });
      expect(issued.issuedAt).toBeInstanceOf(Date);
      expect(issued.lines?.[0].unitCost).toBe(1);
      expect(await quantityIn(main, water)).toBe(90);
      expect(await balanceOf()).toBe(23);

      const movements = await stock.findMovements(tenantA, {
        type: StockMovementType.SALE,
      });
      expect(movements.data).toMatchObject([
        { quantity: -10, unitCost: 1, referenceId: issued.id },
      ]);
    });

    it('gives numbers only at issue time, with no gaps', async () => {
      const cancelled = await newInvoice([
        { productId: water.id, quantity: 1, unitPrice: 2.3 },
      ]);
      await invoices.cancel(cancelled.id, tenantA);

      const first = await issuedInvoice();
      const second = await issuedInvoice();

      expect([first.number, second.number]).toEqual([
        'INV-000001',
        'INV-000002',
      ]);
      expect([first.counter, second.counter]).toEqual([1, 2]);
    });

    it('chains each invoice hash to the previous one', async () => {
      const first = await issuedInvoice();
      const second = await issuedInvoice();

      expect(first.previousInvoiceHash).toBe('');
      expect(second.previousInvoiceHash).toBe(first.invoiceHash);
      expect(second.invoiceHash).toBe(
        computeInvoiceHash({
          uuid: second.uuid,
          number: second.number!,
          issuedAt: second.issuedAt!,
          total: second.total,
          taxTotal: second.taxTotal,
          previousHash: first.invoiceHash!,
        }),
      );
    });

    it('issues unique consecutive numbers under concurrency', async () => {
      const drafts = await Promise.all(
        Array.from({ length: 5 }, () =>
          newInvoice([{ productId: water.id, quantity: 1, unitPrice: 2.3 }]),
        ),
      );

      const issued = await Promise.all(
        drafts.map((d) => invoices.issue(d.id, {}, tenantA)),
      );

      expect(issued.map((i) => i.counter).sort()).toEqual([1, 2, 3, 4, 5]);
      expect(new Set(issued.map((i) => i.number)).size).toBe(5);
    });

    it('issues only once under concurrent requests', async () => {
      const draft = await newInvoice([
        { productId: water.id, quantity: 10, unitPrice: 2.3 },
      ]);

      const outcomes = await Promise.allSettled([
        invoices.issue(draft.id, {}, tenantA),
        invoices.issue(draft.id, {}, tenantA),
      ]);

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(await quantityIn(main, water)).toBe(90);
    });

    it('builds the ZATCA QR only when the seller has a tax number', async () => {
      const without = await issuedInvoice();
      expect(without.qrCode).toBeNull();

      await salesSettings.update(tenantA, {
        sellerName: 'مؤسسة الأفق التجارية',
        taxNumber: '300000000000003',
      });
      const withQr = await issuedInvoice();

      expect(parseZatcaQr(withQr.qrCode!)).toMatchObject({
        1: 'مؤسسة الأفق التجارية',
        2: '300000000000003',
        4: '23.00',
        5: '3.00',
      });
    });

    it('sells without VAT, title or QR for an unregistered business', async () => {
      await salesSettings.update(tenantA, {
        taxNumber: '300000000000003',
        vatRegistered: false,
      });

      const draft = await newInvoice([
        { productId: water.id, quantity: 10, unitPrice: 2.3 },
      ]);
      // نسبة الصنف 15% لكنها لا تُطبَّق: السعر هو الإجمالي
      expect(draft).toMatchObject({ subtotal: 23, taxTotal: 0, total: 23 });
      expect(draft.lines?.[0]).toMatchObject({ taxRate: 0, taxCategory: 'O' });

      const issued = await invoices.issue(draft.id, {}, tenantA);
      expect(issued.qrCode).toBeNull();
      // نسبة الصنف نفسها باقية: تعود إن سُجّلت المنشأة
      expect((await products.findOne(water.id, tenantA)).taxRate?.rate).toBe(
        15,
      );
    });

    it('recomputes a taxed draft before issuing once unregistered', async () => {
      const draft = await newInvoice([
        { productId: water.id, quantity: 10, unitPrice: 2.3 },
      ]);
      expect(draft.taxTotal).toBe(3);
      await salesSettings.update(tenantA, { vatRegistered: false });

      await expect(invoices.issue(draft.id, {}, tenantA)).rejects.toThrow(
        'غير مسجّلة',
      );
      // حفظ المسودة يعيد حسابها بلا ضريبة، فتُصدر
      await invoices.update(draft.id, {}, tenantA);
      await expect(
        invoices.issue(draft.id, {}, tenantA),
      ).resolves.toMatchObject({ taxTotal: 0, total: 23 });
    });

    it('needs a tax number to register, and defaults by country', async () => {
      await salesSettings.update(tenantA, { vatRegistered: false });
      await expect(
        salesSettings.update(tenantA, { vatRegistered: true }),
      ).rejects.toThrow('الرقم الضريبي');
      await expect(
        salesSettings.update(tenantA, {
          vatRegistered: true,
          taxNumber: '300000000000003',
        }),
      ).resolves.toMatchObject({ vatRegistered: true });

      // دولة بلا ضريبة قيمة مضافة: غير مسجّلة من البداية
      const kuwait = await dataSource
        .getRepository(Tenant)
        .save({ companyName: 'شركة الكويت', country: 'KW' });
      expect(await salesSettings.get(kuwait.id)).toMatchObject({
        vatRegistered: false,
        pricesIncludeTax: true,
      });
    });

    it('prices before tax when the company sells net of VAT', async () => {
      await salesSettings.update(tenantA, { pricesIncludeTax: false });
      // 10 × 2.00 قبل الضريبة + 15% = 23
      const draft = await newInvoice([
        { productId: water.id, quantity: 10, unitPrice: 2 },
      ]);
      expect(draft).toMatchObject({
        pricesIncludeTax: false,
        subtotal: 20,
        taxTotal: 3,
        total: 23,
      });
    });

    it('sells services without touching stock', async () => {
      const draft = await newInvoice([
        { productId: delivery.id, quantity: 2, unitPrice: 11.5 },
      ]);
      const issued = await invoices.issue(draft.id, {}, tenantA);

      expect(issued).toMatchObject({ total: 23, costTotal: 0 });
      expect(
        (await stock.findMovements(tenantA, { type: StockMovementType.SALE }))
          .total,
      ).toBe(0);
    });

    it('converts sale units to base units', async () => {
      const draft = await newInvoice([
        { productId: water.id, unitId: carton.id, quantity: 2, unitPrice: 50 },
      ]);
      const issued = await invoices.issue(draft.id, {}, tenantA);

      expect(issued.lines?.[0]).toMatchObject({
        unitName: 'كرتون',
        factor: 24,
        baseQuantity: 48,
      });
      expect(issued.costTotal).toBe(48);
      expect(await quantityIn(main, water)).toBe(52);
    });

    it('follows each warehouse negative-stock rule', async () => {
      const tooMuch = await newInvoice([
        { productId: water.id, quantity: 150, unitPrice: 2.3 },
      ]);
      await expect(invoices.issue(tooMuch.id, {}, tenantA)).rejects.toThrow(
        'الرصيد غير كافٍ',
      );
      // فشل الإصدار لا يترك أثراً: بلا رقم وبلا خصم
      expect(await invoices.findOne(tooMuch.id, tenantA)).toMatchObject({
        status: SalesInvoiceStatus.DRAFT,
        number: null,
      });

      // الفرع يسمح بالسالب: الكاشير لا يتعطل
      const fromBranch = await newInvoice(
        [{ productId: water.id, quantity: 3, unitPrice: 2.3 }],
        { warehouseId: branch.id },
      );
      await invoices.issue(fromBranch.id, {}, tenantA);
      expect(await quantityIn(branch, water)).toBe(-3);
    });

    it('keeps the product name of the time of sale', async () => {
      const issued = await issuedInvoice();
      await products.update(water.id, { name: 'اسم جديد' }, tenantA);

      const reloaded = await invoices.findOne(issued.id, tenantA);

      expect(reloaded.lines?.[0].productName).toBe('مياه 330 مل');
    });
  });

  // ─── القبض عند الإصدار والبيع الآجل ─────────────────────────
  describe('payment at issue and credit sales', () => {
    it('records split tenders at issue', async () => {
      const issued = await issuedInvoice([
        { method: CASH, amount: 13 },
        { method: SalesPaymentMethod.CARD, amount: 10, reference: 'AUTH-1' },
      ]);

      expect(issued).toMatchObject({
        paidAmount: 23,
        remaining: 0,
        paymentStatus: 'paid',
      });
      const list = await payments.findAll(tenantA, { invoiceId: issued.id });
      expect(list.data.map((p) => [p.method, p.amount]).sort()).toEqual([
        ['card', 10],
        ['cash', 13],
      ]);
      expect(await balanceOf()).toBe(0);
    });

    it('requires a walk-in sale to be paid in full', async () => {
      const draft = await newInvoice(
        [{ productId: water.id, quantity: 10, unitPrice: 2.3 }],
        { customerId: null },
      );

      await expect(
        invoices.issue(
          draft.id,
          { payments: [{ method: CASH, amount: 20 }] },
          tenantA,
        ),
      ).rejects.toThrow('البيع الآجل يحتاج عميلاً');

      const issued = await invoices.issue(
        draft.id,
        { payments: [{ method: CASH, amount: 23 }] },
        tenantA,
      );
      expect(issued).toMatchObject({ customerId: null, paymentStatus: 'paid' });
    });

    it('rejects tendering more than the total', async () => {
      const draft = await newInvoice([
        { productId: water.id, quantity: 10, unitPrice: 2.3 },
      ]);

      await expect(
        invoices.issue(
          draft.id,
          { payments: [{ method: CASH, amount: 30 }] },
          tenantA,
        ),
      ).rejects.toThrow('أكبر من إجمالي الفاتورة');
    });

    it('enforces the customer credit limit', async () => {
      await customers.update(customer.id, { creditLimit: 40 }, tenantA);
      await issuedInvoice(); // عليه 23

      const second = await newInvoice([
        { productId: water.id, quantity: 10, unitPrice: 2.3 },
      ]);
      await expect(invoices.issue(second.id, {}, tenantA)).rejects.toThrow(
        'تجاوز الحد الائتماني',
      );

      // قبض جزء عند الإصدار يُبقيه ضمن الحد: 23 + (23 − 10) = 36
      const issued = await invoices.issue(
        second.id,
        { payments: [{ method: CASH, amount: 10 }] },
        tenantA,
      );
      expect(issued.paymentStatus).toBe('partial');
      expect(await balanceOf()).toBe(36);
    });

    it('refuses to issue for an inactive customer', async () => {
      const draft = await newInvoice([
        { productId: water.id, quantity: 1, unitPrice: 2.3 },
      ]);
      await customers.update(customer.id, { isActive: false }, tenantA);

      await expect(invoices.issue(draft.id, {}, tenantA)).rejects.toThrow(
        'موقوف',
      );
    });
  });

  // ─── المقبوضات ──────────────────────────────────────────────
  describe('customer payments', () => {
    it('collects an invoice partially then fully', async () => {
      const invoice = await issuedInvoice();
      const collect = (amount: number) =>
        payments.create(
          { invoiceId: invoice.id, paymentDate: TODAY, amount },
          tenantA,
        );

      const first = await collect(10);
      expect(first).toMatchObject({
        number: 'RC-000001',
        customerId: customer.id, // يؤخذ من الفاتورة
        direction: PaymentDirection.IN,
      });
      expect(await invoices.findOne(invoice.id, tenantA)).toMatchObject({
        remaining: 13,
        paymentStatus: 'partial',
      });

      await collect(13);
      expect(await balanceOf()).toBe(0);
      await expect(collect(0.01)).rejects.toThrow('أكبر من المتبقي');
    });

    it('never over-collects under concurrent payments', async () => {
      const invoice = await issuedInvoice();

      const outcomes = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          payments.create(
            { invoiceId: invoice.id, paymentDate: TODAY, amount: 10 },
            tenantA,
          ),
        ),
      );

      // 23 تتحمل دفعتين بـ 10 فقط
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(2);
      expect((await invoices.findOne(invoice.id, tenantA)).paidAmount).toBe(20);
    });

    it('records a payment on account and cancels a payment', async () => {
      const invoice = await issuedInvoice();
      await payments.create(
        { customerId: customer.id, paymentDate: TODAY, amount: 5 },
        tenantA,
      );
      expect(await balanceOf()).toBe(18);

      const onInvoice = await payments.create(
        { invoiceId: invoice.id, paymentDate: TODAY, amount: 10 },
        tenantA,
      );
      const cancelled = await payments.cancel(onInvoice.id, tenantA);

      expect(cancelled.status).toBe(CustomerPaymentStatus.CANCELLED);
      expect((await invoices.findOne(invoice.id, tenantA)).remaining).toBe(23);
      expect(await balanceOf()).toBe(18);
      await expect(payments.cancel(onInvoice.id, tenantA)).rejects.toThrow(
        'ملغي بالفعل',
      );
    });

    it('validates the invoice, customer and tenant', async () => {
      const invoice = await issuedInvoice();
      const other = await customers.create({ name: 'عميل آخر' }, tenantA);

      await expect(
        payments.create({ paymentDate: TODAY, amount: 1 }, tenantA),
      ).rejects.toThrow('اختر العميل أو الفاتورة');
      await expect(
        payments.create(
          {
            customerId: other.id,
            invoiceId: invoice.id,
            paymentDate: TODAY,
            amount: 1,
          },
          tenantA,
        ),
      ).rejects.toThrow('ليست لهذا العميل');
      await expect(
        payments.create(
          { invoiceId: invoice.id, paymentDate: TODAY, amount: 1 },
          tenantB,
        ),
      ).rejects.toThrow('فاتورة البيع غير موجودة');
    });

    it('does not cancel the payment of a walk-in cash sale', async () => {
      const draft = await newInvoice(
        [{ productId: water.id, quantity: 1, unitPrice: 2.3 }],
        { customerId: null },
      );
      const issued = await invoices.issue(
        draft.id,
        { payments: [{ method: CASH, amount: 2.3 }] },
        tenantA,
      );
      const [payment] = (
        await payments.findAll(tenantA, { invoiceId: issued.id })
      ).data;

      await expect(payments.cancel(payment.id, tenantA)).rejects.toThrow(
        'فاتورة نقدية بلا عميل',
      );
    });
  });

  // ─── المرتجعات ──────────────────────────────────────────────
  describe('sales returns', () => {
    const newReturn = (invoice: SalesInvoice, quantity: number) =>
      returns.create(
        {
          invoiceId: invoice.id,
          returnDate: TODAY,
          reason: 'غير مطابق',
          lines: [{ invoiceLineId: invoice.lines![0].id, quantity }],
        },
        tenantA,
      );

    it('returns goods to stock at their original cost and credits the customer', async () => {
      const invoice = await issuedInvoice();
      // التكلفة تغيّرت بعد البيع: المرتجع يعود بتكلفة البيع (1) لا الحالية
      await stock.adjust(
        {
          warehouseId: main.id,
          type: StockMovementType.OPENING,
          lines: [{ productId: water.id, quantity: 90, unitCost: 3 }],
        },
        tenantA,
      );

      const draft = await newReturn(invoice, 4);
      expect(draft).toMatchObject({
        number: null,
        status: SalesReturnStatus.DRAFT,
        subtotal: 8,
        taxTotal: 1.2,
        total: 9.2,
      });

      const issued = await returns.issue(draft.id, {}, tenantA);
      const after = await invoices.findOne(invoice.id, tenantA);

      expect(issued).toMatchObject({
        number: 'CN-000001',
        status: SalesReturnStatus.ISSUED,
      });
      expect(await quantityIn(main, water)).toBe(184);
      expect(await balanceOf()).toBe(13.8);
      expect(after).toMatchObject({ returnedAmount: 9.2, remaining: 13.8 });
      expect(after.lines?.[0].returnedQuantity).toBe(4);

      const [movement] = (
        await stock.findMovements(tenantA, {
          type: StockMovementType.SALE_RETURN,
        })
      ).data;
      expect(movement).toMatchObject({ quantity: 4, unitCost: 1 });
    });

    it('refunds the overpaid amount of a paid invoice', async () => {
      const invoice = await issuedInvoice([{ method: CASH, amount: 23 }]);
      const draft = await newReturn(invoice, 4); // قيمته 9.20

      await expect(
        returns.issue(
          draft.id,
          { refund: { method: CASH, amount: 10 } },
          tenantA,
        ),
      ).rejects.toThrow('أكبر من المدفوع الزائد');

      const issued = await returns.issue(
        draft.id,
        { refund: { method: CASH, amount: 9.2 } },
        tenantA,
      );
      const after = await invoices.findOne(invoice.id, tenantA);

      expect(issued.refundedAmount).toBe(9.2);
      expect(after).toMatchObject({
        paidAmount: 13.8,
        remaining: 0,
        overpaid: 0,
      });
      expect(await balanceOf()).toBe(0);
      const refunds = await payments.findAll(tenantA, {
        direction: PaymentDirection.OUT,
      });
      expect(refunds.data).toMatchObject([{ amount: 9.2 }]);
    });

    it('keeps an unrefunded return as customer credit', async () => {
      const invoice = await issuedInvoice([{ method: CASH, amount: 23 }]);
      const draft = await newReturn(invoice, 10);

      await returns.issue(draft.id, {}, tenantA);

      expect(await balanceOf()).toBe(-23); // للعميل رصيد عندنا
      expect((await invoices.findOne(invoice.id, tenantA)).overpaid).toBe(23);
    });

    it('requires refunding a walk-in customer', async () => {
      const draft = await newInvoice(
        [{ productId: water.id, quantity: 10, unitPrice: 2.3 }],
        { customerId: null },
      );
      const invoice = await invoices.issue(
        draft.id,
        { payments: [{ method: CASH, amount: 23 }] },
        tenantA,
      );
      const ret = await newReturn(invoice, 10);

      await expect(returns.issue(ret.id, {}, tenantA)).rejects.toThrow(
        'يجب ردّ 23',
      );
      await returns.issue(
        ret.id,
        { refund: { method: CASH, amount: 23 } },
        tenantA,
      );
      expect((await invoices.findOne(invoice.id, tenantA)).paidAmount).toBe(0);
    });

    it('never returns more than was sold, even across returns', async () => {
      const invoice = await issuedInvoice();
      await expect(newReturn(invoice, 11)).rejects.toThrow(
        'أكبر من المتاح للإرجاع',
      );

      const first = await newReturn(invoice, 6);
      const second = await newReturn(invoice, 6);
      await returns.issue(first.id, {}, tenantA);

      await expect(returns.issue(second.id, {}, tenantA)).rejects.toThrow(
        'أكبر من المتاح للإرجاع (4)',
      );
    });

    it('returns services without stock movements', async () => {
      const draft = await newInvoice([
        { productId: delivery.id, quantity: 2, unitPrice: 11.5 },
      ]);
      const invoice = await invoices.issue(draft.id, {}, tenantA);
      const ret = await newReturn(invoice, 1);

      await returns.issue(ret.id, {}, tenantA);

      expect(
        (
          await stock.findMovements(tenantA, {
            type: StockMovementType.SALE_RETURN,
          })
        ).total,
      ).toBe(0);
      expect(await balanceOf()).toBe(11.5);
    });

    it('only returns from issued invoices and enforces its lifecycle', async () => {
      const draftInvoice = await newInvoice([
        { productId: water.id, quantity: 1, unitPrice: 2.3 },
      ]);
      await expect(newReturn(draftInvoice, 1)).rejects.toThrow(
        'فاتورة بيع صادرة',
      );

      const invoice = await issuedInvoice();
      const ret = await newReturn(invoice, 1);
      await returns.issue(ret.id, {}, tenantA);

      await expect(returns.issue(ret.id, {}, tenantA)).rejects.toThrow('صادر');
      await expect(returns.cancel(ret.id, tenantA)).rejects.toThrow('صادر');
      await expect(returns.findOne(ret.id, tenantB)).rejects.toThrow(
        'المرتجع غير موجود',
      );
    });
  });

  // ─── كشف الحساب والملخص ─────────────────────────────────────
  describe('statement and summary', () => {
    it('lists every entry with a running balance', async () => {
      await customers.update(customer.id, { openingBalance: 100 }, tenantA);
      const invoice = await issuedInvoice([{ method: CASH, amount: 23 }]);
      const ret = await returns.create(
        {
          invoiceId: invoice.id,
          returnDate: TODAY,
          lines: [{ invoiceLineId: invoice.lines![0].id, quantity: 10 }],
        },
        tenantA,
      );
      await returns.issue(
        ret.id,
        { refund: { method: CASH, amount: 23 } },
        tenantA,
      );
      await payments.create(
        { customerId: customer.id, paymentDate: '2026-10-13', amount: 40 },
        tenantA,
      );

      const statement = await customers.statement(customer.id, tenantA);

      expect(statement.openingBalance).toBe(100);
      // قيود نفس اليوم تُرتَّب بوقت تسجيلها: قبض الإصدار قبل ختم الإصدار
      expect(
        statement.entries
          .map((e) => [e.type, e.debit, e.credit])
          // بالنوع ثم المبلغ: ترتيب القبضين بالتاريخ يتبع يوم تشغيل الاختبار
          .sort(
            (a, b) =>
              String(a[0]).localeCompare(String(b[0])) ||
              Number(a[2]) - Number(b[2]),
          ),
      ).toEqual([
        ['invoice', 23, 0],
        ['payment', 0, 23],
        ['payment', 0, 40],
        ['refund', 23, 0],
        ['return', 0, 23],
      ]);
      expect(statement).toMatchObject({
        totalDebit: 46,
        totalCredit: 86,
        closingBalance: 60,
      });
      expect(statement.entries.at(-1)?.balance).toBe(60);
      expect(await balanceOf()).toBe(60);
    });

    it('summarises sales, profit and receivables', async () => {
      // فاتورة آجلة بتاريخ اليوم الفعلي ليحسبها ملخص "اليوم"
      const today = new Date();
      const todayStamp = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0'),
      ].join('-');
      const draft = await invoices.create(
        {
          customerId: customer.id,
          warehouseId: main.id,
          invoiceDate: todayStamp,
          lines: [{ productId: water.id, quantity: 10, unitPrice: 2.3 }],
        },
        tenantA,
      );
      await invoices.issue(draft.id, {}, tenantA);
      await newInvoice([{ productId: water.id, quantity: 1, unitPrice: 2.3 }]);

      const summary = await invoices.summary(tenantA);

      expect(summary).toMatchObject({
        todaySales: 23,
        monthSales: 23,
        monthProfit: 10, // 20 قبل الضريبة − تكلفة 10
        receivables: 23,
        draftInvoices: 1,
      });
      expect(await invoices.countIssuedThisMonth(tenantA)).toBe(1);
      expect((await invoices.summary(tenantB)).monthSales).toBe(0);
    });
  });
});
