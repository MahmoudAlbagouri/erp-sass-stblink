import { DataSource } from 'typeorm';
import { CatalogSettingsService } from '../src/modules/catalog/catalog-settings.service';
import { CreateProductDto } from '../src/modules/catalog/dto/product.dto';
import { ProductBarcode } from '../src/modules/catalog/entities/product-barcode.entity';
import { ProductCategory } from '../src/modules/catalog/entities/product-category.entity';
import { Product } from '../src/modules/catalog/entities/product.entity';
import { TaxRate } from '../src/modules/catalog/entities/tax-rate.entity';
import { Unit } from '../src/modules/catalog/entities/unit.entity';
import { ProductsService } from '../src/modules/catalog/products.service';
import { Tenant } from '../src/modules/tenants/entities/tenant.entity';
import { createTestDataSource, truncateAllTables } from './utils/test-database';

describe('catalog module', () => {
  let dataSource: DataSource;
  let settings: CatalogSettingsService;
  let products: ProductsService;

  let tenantA: string;
  let tenantB: string;
  let piece: Unit;
  let carton: Unit;

  const newProduct = (overrides: Partial<CreateProductDto> = {}) =>
    products.create(
      { name: 'مياه 330 مل', baseUnitId: piece.id, salePrice: 2, ...overrides },
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
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    const tenants = dataSource.getRepository(Tenant);
    tenantA = (await tenants.save({ companyName: 'شركة أ' })).id;
    tenantB = (await tenants.save({ companyName: 'شركة ب' })).id;

    const units = await settings.findUnits(tenantA);
    piece = units.find((u) => u.name === 'قطعة')!;
    carton = units.find((u) => u.name === 'كرتون')!;
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  // ─── القيم الافتراضية ───────────────────────────────────────
  describe('defaults', () => {
    it('seeds units and tax rates once for a new tenant', async () => {
      const first = await settings.findUnits(tenantA);
      const second = await settings.findUnits(tenantA);
      const taxes = await settings.findTaxRates(tenantA);

      expect(first.length).toBeGreaterThan(0);
      expect(second).toHaveLength(first.length);
      expect(taxes.filter((t) => t.isDefault)).toHaveLength(1);
      expect(taxes.find((t) => t.isDefault)?.rate).toBe(15);
    });

    it('seeds defaults once when a new tenant is hit by parallel requests', async () => {
      // صفحة الأصناف تطلب الوحدات والضرائب معاً عند أول فتح لشركة جديدة
      const results = await Promise.all([
        settings.findUnits(tenantB),
        settings.findTaxRates(tenantB),
        settings.findUnits(tenantB),
        settings.findTaxRates(tenantB),
        settings.getDefaultTaxRate(tenantB),
      ]);

      const units = await settings.findUnits(tenantB);
      const taxes = await settings.findTaxRates(tenantB);
      expect(results).toHaveLength(5);
      expect(new Set(units.map((u) => u.name)).size).toBe(units.length);
      expect(units.length).toBeGreaterThan(0);
      expect(taxes.filter((t) => t.isDefault)).toHaveLength(1);
    });

    it('does not re-seed units a tenant deleted on purpose', async () => {
      for (const unit of await settings.findUnits(tenantA)) {
        await settings.removeUnit(unit.id, tenantA);
      }

      expect(await settings.findUnits(tenantA)).toHaveLength(0);
    });
  });

  // ─── الأصناف ────────────────────────────────────────────────
  describe('products', () => {
    it('creates a product with the default tax and a generated sku', async () => {
      const product = await newProduct();

      expect(product.sku).toBe('P-000001');
      expect(product.taxRate?.rate).toBe(15);
      expect(product.salePrice).toBe(2); // رقم وليس نصاً
      expect(product.priceIncludesTax).toBe(true);
    });

    it('increments generated skus and skips manually taken ones', async () => {
      await newProduct({ sku: 'P-000005' });

      const next = await newProduct({ name: 'عصير' });

      expect(next.sku).toBe('P-000006');
    });

    it('rejects a duplicate sku inside the same tenant only', async () => {
      await newProduct({ sku: 'WATER' });

      await expect(newProduct({ sku: 'WATER' })).rejects.toThrow(/مستخدم/);

      const unitsB = await settings.findUnits(tenantB);
      const inOtherTenant = await products.create(
        { name: 'مياه', sku: 'WATER', baseUnitId: unitsB[0].id, salePrice: 2 },
        tenantB,
      );
      expect(inOtherTenant.sku).toBe('WATER');
    });

    it('lets a deleted product’s sku be reused', async () => {
      const product = await newProduct({ sku: 'WATER' });
      await products.remove(product.id, tenantA);

      await expect(newProduct({ sku: 'WATER' })).resolves.toBeDefined();
    });

    it('rejects a minimum price above the sale price', async () => {
      await expect(
        newProduct({ salePrice: 10, minSalePrice: 12 }),
      ).rejects.toThrow(/أقل سعر/);
    });

    it('filters and paginates the list', async () => {
      const category = await settings.createCategory(
        { name: 'مشروبات' },
        tenantA,
      );
      await newProduct({ name: 'مياه', categoryId: category.id });
      await newProduct({ name: 'عصير برتقال', categoryId: category.id });
      await newProduct({ name: 'خبز' });

      const byCategory = await products.findAll(tenantA, {
        categoryId: category.id,
      });
      const bySearch = await products.findAll(tenantA, { search: 'عصير' });
      const paged = await products.findAll(tenantA, { page: 2, limit: 2 });

      expect(byCategory.total).toBe(2);
      expect(bySearch.data.map((p) => p.name)).toEqual(['عصير برتقال']);
      expect(paged.data).toHaveLength(1);
      expect(paged.totalPages).toBe(2);
    });
  });

  // ─── عزل الشركات ────────────────────────────────────────────
  describe('tenant isolation', () => {
    it('never returns another tenant’s products', async () => {
      const product = await newProduct();

      const listB = await products.findAll(tenantB, {});

      expect(listB.total).toBe(0);
      await expect(products.findOne(product.id, tenantB)).rejects.toThrow(
        /غير موجود/,
      );
      await expect(
        products.update(product.id, { name: 'مخترَق' }, tenantB),
      ).rejects.toThrow(/غير موجود/);
      await expect(products.remove(product.id, tenantB)).rejects.toThrow(
        /غير موجود/,
      );
    });

    it('rejects references that belong to another tenant', async () => {
      const unitsB = await settings.findUnits(tenantB);
      const categoryB = await settings.createCategory({ name: 'خاص' }, tenantB);

      await expect(newProduct({ baseUnitId: unitsB[0].id })).rejects.toThrow(
        /الوحدة غير موجودة/,
      );
      await expect(newProduct({ categoryId: categoryB.id })).rejects.toThrow(
        /التصنيف غير موجود/,
      );
    });
  });

  // ─── الباركود والوحدات ──────────────────────────────────────
  describe('barcodes and units', () => {
    it('finds a product by its base-unit barcode', async () => {
      await newProduct({
        salePrice: 2,
        barcodes: [{ barcode: '6281000000017' }],
      });

      const hit = await products.findByBarcode('6281000000017', tenantA);

      expect(hit.product.name).toBe('مياه 330 مل');
      expect(hit.unitId).toBeNull();
      expect(hit.factor).toBe(1);
      expect(hit.unitPrice).toBe(2);
    });

    it('resolves a carton barcode to its unit, factor and price', async () => {
      await newProduct({
        salePrice: 2,
        units: [{ unitId: carton.id, factor: 24, salePrice: 45 }],
        barcodes: [
          { barcode: '6281000000017' },
          { barcode: '16281000000014', unitId: carton.id },
        ],
      });

      const hit = await products.findByBarcode('16281000000014', tenantA);

      expect(hit.unitId).toBe(carton.id);
      expect(hit.factor).toBe(24);
      expect(hit.unitPrice).toBe(45);
    });

    it('prices a pack unit as base price × factor when it has no own price', async () => {
      await newProduct({
        salePrice: 2.5,
        units: [{ unitId: carton.id, factor: 12 }],
        barcodes: [{ barcode: 'CARTON-1', unitId: carton.id }],
      });

      const hit = await products.findByBarcode('CARTON-1', tenantA);

      expect(hit.unitPrice).toBe(30);
    });

    it('keeps barcodes unique per tenant', async () => {
      await newProduct({ barcodes: [{ barcode: '111222333' }] });

      await expect(
        newProduct({ name: 'عصير', barcodes: [{ barcode: '111222333' }] }),
      ).rejects.toThrow(/مستخدم للصنف/);

      await expect(
        products.findByBarcode('111222333', tenantB),
      ).rejects.toThrow(/لا يوجد صنف/);
    });

    it('rolls back the whole product when a barcode conflicts', async () => {
      await newProduct({ barcodes: [{ barcode: '111222333' }] });

      await expect(
        newProduct({ name: 'عصير', barcodes: [{ barcode: '111222333' }] }),
      ).rejects.toThrow();

      expect((await products.findAll(tenantA, {})).total).toBe(1);
    });

    it('frees barcodes when the product is deleted', async () => {
      const product = await newProduct({
        barcodes: [{ barcode: '111222333' }],
      });
      await products.remove(product.id, tenantA);

      await expect(
        newProduct({ name: 'بديل', barcodes: [{ barcode: '111222333' }] }),
      ).resolves.toBeDefined();
    });

    it('rejects the base unit as an extra unit, and duplicate units', async () => {
      await expect(
        newProduct({ units: [{ unitId: piece.id, factor: 1 }] }),
      ).rejects.toThrow(/وحدة الأساس/);
      await expect(
        newProduct({
          units: [
            { unitId: carton.id, factor: 12 },
            { unitId: carton.id, factor: 24 },
          ],
        }),
      ).rejects.toThrow(/تكرار/);
    });

    it('rejects a barcode tied to a unit the product does not have', async () => {
      await expect(
        newProduct({ barcodes: [{ barcode: 'X-1', unitId: carton.id }] }),
      ).rejects.toThrow(/ليست من وحدات الصنف/);
    });

    it('replaces barcodes on update and bumps updatedAt for sync', async () => {
      const product = await newProduct({ barcodes: [{ barcode: 'OLD-1' }] });

      const updated = await products.update(
        product.id,
        { barcodes: [{ barcode: 'NEW-1' }] },
        tenantA,
      );

      expect(updated.barcodes?.map((b) => b.barcode)).toEqual(['NEW-1']);
      expect(updated.updatedAt.getTime()).toBeGreaterThan(
        product.updatedAt.getTime(),
      );
      await expect(products.findByBarcode('OLD-1', tenantA)).rejects.toThrow();
    });
  });

  // ─── التصنيفات والوحدات والضرائب ────────────────────────────
  describe('settings', () => {
    it('blocks deleting a category that has products or children', async () => {
      const parent = await settings.createCategory({ name: 'أغذية' }, tenantA);
      const child = await settings.createCategory(
        { name: 'مشروبات', parentId: parent.id },
        tenantA,
      );
      await newProduct({ categoryId: child.id });

      await expect(settings.removeCategory(parent.id, tenantA)).rejects.toThrow(
        /تصنيف فرعي/,
      );
      await expect(settings.removeCategory(child.id, tenantA)).rejects.toThrow(
        /صنف مرتبط/,
      );
    });

    it('prevents moving a category under its own descendant', async () => {
      const parent = await settings.createCategory({ name: 'أغذية' }, tenantA);
      const child = await settings.createCategory(
        { name: 'مشروبات', parentId: parent.id },
        tenantA,
      );

      await expect(
        settings.updateCategory(parent.id, { parentId: child.id }, tenantA),
      ).rejects.toThrow(/تحت نفسه/);
    });

    it('allows the same category name under different parents only', async () => {
      const a = await settings.createCategory({ name: 'أ' }, tenantA);
      const b = await settings.createCategory({ name: 'ب' }, tenantA);
      await settings.createCategory({ name: 'متنوع', parentId: a.id }, tenantA);

      await expect(
        settings.createCategory({ name: 'متنوع', parentId: b.id }, tenantA),
      ).resolves.toBeDefined();
      await expect(
        settings.createCategory({ name: 'متنوع', parentId: a.id }, tenantA),
      ).rejects.toThrow(/بنفس الاسم/);
    });

    it('blocks deleting a unit or tax rate that products use', async () => {
      const product = await newProduct({
        units: [{ unitId: carton.id, factor: 24 }],
      });

      await expect(settings.removeUnit(piece.id, tenantA)).rejects.toThrow(
        /مستخدمة/,
      );
      await expect(settings.removeUnit(carton.id, tenantA)).rejects.toThrow(
        /مستخدمة/,
      );
      await expect(
        settings.removeTaxRate(product.taxRateId, tenantA),
      ).rejects.toThrow(/مستخدمة/);
    });

    it('keeps exactly one default tax rate', async () => {
      const created = await settings.createTaxRate(
        { name: 'ضريبة 5%', rate: 5, isDefault: true },
        tenantA,
      );

      const defaults = (await settings.findTaxRates(tenantA)).filter(
        (t) => t.isDefault,
      );

      expect(defaults.map((t) => t.id)).toEqual([created.id]);
    });
  });
});
