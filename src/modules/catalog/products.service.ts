// src/modules/catalog/products.service.ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { moneyDecimalsOf, roundMoney } from '../../common/utils/money.util';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  paginated,
  Paginated,
  resolvePagination,
} from '../../common/dto/pagination.dto';
import { CatalogSettingsService } from './catalog-settings.service';
import {
  CreateProductDto,
  ProductBarcodeDto,
  ProductQueryDto,
  ProductUnitDto,
  UpdateProductDto,
} from './dto/product.dto';
import { ProductBarcode } from './entities/product-barcode.entity';
import { ProductUnit } from './entities/product-unit.entity';
import { Product } from './entities/product.entity';
import { FilesService } from '../files/files.service';

const PRODUCT_RELATIONS = [
  'category',
  'baseUnit',
  'taxRate',
  'barcodes',
  'units',
  'units.unit',
  'image',
];

const SKU_PREFIX = 'P-';
const SKU_DIGITS = 6;

/** نتيجة البحث بالباركود: الصنف + الوحدة التي يمثلها الباركود وسعرها */
export interface BarcodeLookupResult {
  product: Product;
  barcode: string;
  /** null = وحدة الأساس */
  unitId: string | null;
  /** كم وحدة أساس تُخصم من المخزون عند بيع هذا الباركود */
  factor: number;
  unitPrice: number;
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(ProductBarcode)
    private readonly barcodes: Repository<ProductBarcode>,
    private readonly settings: CatalogSettingsService,
    private readonly dataSource: DataSource,
    private readonly files: FilesService,
  ) {}

  // ══════════════════════════ القراءة ══════════════════════════

  async findAll(
    tenantId: string,
    query: ProductQueryDto,
  ): Promise<Paginated<Product>> {
    const { page, limit, skip } = resolvePagination(query);

    const qb = this.products
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.baseUnit', 'baseUnit')
      .leftJoinAndSelect('product.taxRate', 'taxRate')
      .leftJoinAndSelect('product.barcodes', 'barcodes')
      .where('product.tenantId = :tenantId', { tenantId });

    const search = query.search?.trim();
    if (search) {
      // الباركود يُطابَق كاملاً (ما يرسله القارئ)، والاسم/الكود جزئياً
      qb.andWhere(
        `(product.name ILIKE :like OR product.nameEn ILIKE :like OR product.sku ILIKE :like
          OR EXISTS (SELECT 1 FROM product_barcodes b
                     WHERE b."productId" = product.id AND b.barcode = :exact))`,
        { like: `%${search}%`, exact: search },
      );
    }
    if (query.categoryId) {
      qb.andWhere('product.categoryId = :categoryId', {
        categoryId: query.categoryId,
      });
    }
    if (query.type) {
      qb.andWhere('product.type = :type', { type: query.type });
    }
    if (query.isActive !== undefined) {
      qb.andWhere('product.isActive = :isActive', {
        isActive: query.isActive === 'true',
      });
    }

    const [data, total] = await qb
      .orderBy('product.createdAt', 'DESC')
      .addOrderBy('product.id', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return paginated(data, total, page, limit);
  }

  async findOne(id: string, tenantId: string): Promise<Product> {
    const product = await this.products.findOne({
      where: { id, tenantId },
      relations: PRODUCT_RELATIONS,
    });
    if (!product) throw new NotFoundException('الصنف غير موجود');
    return product;
  }

  /** ما يحتاجه الكاشير عند قراءة باركود: الصنف + الوحدة + السعر */
  async findByBarcode(
    barcode: string,
    tenantId: string,
  ): Promise<BarcodeLookupResult> {
    const match = await this.barcodes.findOne({
      where: { tenantId, barcode: barcode.trim() },
    });
    if (!match) throw new NotFoundException('لا يوجد صنف بهذا الباركود');

    const product = await this.findOne(match.productId, tenantId);
    const productUnit = match.unitId
      ? product.units?.find((u) => u.unitId === match.unitId)
      : undefined;

    const factor = productUnit?.factor ?? 1;
    const unitPrice =
      productUnit?.salePrice ??
      roundMoney(
        product.salePrice * factor,
        await moneyDecimalsOf(this.dataSource.manager, tenantId),
      );

    return {
      product,
      barcode: match.barcode,
      unitId: productUnit ? productUnit.unitId : null,
      factor,
      unitPrice,
    };
  }

  /**
   * أصناف الشركة بمعرّفاتها (مع وحدة الأساس) — للموديولات الأخرى
   * (مخزون، مشتريات، مبيعات). ما لا يتبع الشركة أو حُذف لا يُعاد.
   *
   * من يستدعيها داخل معاملة يمرّر الـ manager: القراءة على اتصال آخر من
   * داخل معاملة تستنزف الـ pool تحت الضغط (كل المعاملات تنتظر اتصالاً).
   */
  findByIds(
    ids: string[],
    tenantId: string,
    manager?: EntityManager,
    relations: string[] = ['baseUnit'],
  ): Promise<Product[]> {
    if (ids.length === 0) return Promise.resolve([]);
    const repository = manager?.getRepository(Product) ?? this.products;
    return repository.find({
      where: { tenantId, id: In([...new Set(ids)]) },
      relations,
    });
  }

  /**
   * أصناف فاتورة أصدرها الكاشير بلا إنترنت: تشمل ما حُذف بعدها، فالبيع وقع
   * فعلاً ويجب أن يُسجَّل.
   */
  findSoldByIds(ids: string[], tenantId: string): Promise<Product[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.products.find({
      where: { tenantId, id: In([...new Set(ids)]) },
      relations: ['baseUnit', 'units', 'units.unit', 'taxRate'],
      withDeleted: true,
    });
  }

  /**
   * ما تغيّر من الأصناف منذ وقت معيّن (كلها إن لم يُحدَّد) — لمزامنة أجهزة
   * الكاشير. يشمل المحذوف (deletedAt) ليزيله الجهاز من نسخته المحلية.
   */
  findChangedSince(tenantId: string, since?: Date): Promise<Product[]> {
    const qb = this.products
      .createQueryBuilder('product')
      .withDeleted()
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.baseUnit', 'baseUnit')
      .leftJoinAndSelect('product.taxRate', 'taxRate')
      .leftJoinAndSelect('product.barcodes', 'barcodes')
      .leftJoinAndSelect('product.units', 'units')
      .leftJoinAndSelect('units.unit', 'unit')
      .where('product.tenantId = :tenantId', { tenantId });

    if (since) {
      qb.andWhere(
        '(product.updatedAt > :since OR product.deletedAt > :since)',
        { since },
      );
    } else {
      // أول تحميل: لا حاجة لإرسال ما حُذف أصلاً
      qb.andWhere('product.deletedAt IS NULL');
    }
    return qb.orderBy('product.name', 'ASC').getMany();
  }

  /** عدد الأصناف الفعّالة — يستخدمه حد الخطة (max_products) */
  countActive(tenantId: string): Promise<number> {
    return this.products.count({ where: { tenantId } });
  }

  // ══════════════════════════ الإنشاء والتعديل ══════════════════════════

  async create(dto: CreateProductDto, tenantId: string): Promise<Product> {
    const { barcodes = [], units = [], sku, taxRateId, ...fields } = dto;
    await this.files.assertOwned([fields.imageFileId], tenantId);

    await this.assertReferences(tenantId, {
      categoryId: fields.categoryId,
      baseUnitId: fields.baseUnitId,
      taxRateId,
    });
    this.assertPricing(fields.salePrice, fields.minSalePrice);
    await this.assertUnitsValid(units, fields.baseUnitId, tenantId);
    this.assertBarcodeUnits(barcodes, units, fields.baseUnitId);

    const resolvedTaxRateId =
      taxRateId ?? (await this.settings.getDefaultTaxRate(tenantId)).id;

    const id = await this.dataSource.transaction(async (manager) => {
      const finalSku = sku
        ? await this.assertSkuFree(manager, sku, tenantId)
        : await this.generateSku(manager, tenantId);

      const product = await manager.save(
        manager.create(Product, {
          ...fields,
          categoryId: fields.categoryId ?? null,
          sku: finalSku,
          taxRateId: resolvedTaxRateId,
          tenantId,
        }),
      );

      await this.replaceUnits(manager, product.id, tenantId, units);
      await this.replaceBarcodes(manager, product.id, tenantId, barcodes);
      return product.id;
    });

    return this.findOne(id, tenantId);
  }

  async update(
    id: string,
    dto: UpdateProductDto,
    tenantId: string,
  ): Promise<Product> {
    const product = await this.findOne(id, tenantId);
    const { barcodes, units, sku, ...fields } = dto;
    await this.files.assertOwned([fields.imageFileId], tenantId);

    await this.assertReferences(tenantId, {
      categoryId: fields.categoryId,
      baseUnitId: fields.baseUnitId,
      taxRateId: fields.taxRateId,
    });

    const baseUnitId = fields.baseUnitId ?? product.baseUnitId;
    this.assertPricing(
      fields.salePrice ?? product.salePrice,
      fields.minSalePrice === undefined
        ? product.minSalePrice
        : fields.minSalePrice,
    );

    // الوحدات/الباركودات بعد التعديل: المُرسَل إن وُجد، وإلا الحالي
    const nextUnits: ProductUnitDto[] =
      units ??
      (product.units ?? []).map((u) => ({
        unitId: u.unitId,
        factor: u.factor,
        salePrice: u.salePrice,
      }));
    const nextBarcodes: ProductBarcodeDto[] =
      barcodes ??
      (product.barcodes ?? []).map((b) => ({
        barcode: b.barcode,
        unitId: b.unitId,
      }));

    await this.assertUnitsValid(nextUnits, baseUnitId, tenantId);
    this.assertBarcodeUnits(nextBarcodes, nextUnits, baseUnitId);

    await this.dataSource.transaction(async (manager) => {
      const changes: Partial<Product> = { ...fields };
      if (sku && sku !== product.sku) {
        changes.sku = await this.assertSkuFree(manager, sku, tenantId, id);
      }
      if (Object.keys(changes).length > 0) {
        await manager.update(Product, { id, tenantId }, changes);
      }

      if (units !== undefined) {
        await this.replaceUnits(manager, id, tenantId, units);
      }
      if (barcodes !== undefined) {
        await this.replaceBarcodes(manager, id, tenantId, barcodes);
      }
      // تعديل الوحدات/الباركودات تغيير في الصنف: يجب أن تلتقطه مزامنة الكاشير
      await manager.update(
        Product,
        { id, tenantId },
        { updatedAt: new Date() },
      );
    });

    return this.findOne(id, tenantId);
  }

  /**
   * حذف منطقي: الصنف يبقى للفواتير القديمة، وتُحرَّر باركوداته لإعادة
   * استخدامها.
   */
  async remove(id: string, tenantId: string): Promise<void> {
    const product = await this.findOne(id, tenantId);

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(ProductBarcode, { productId: id, tenantId });
      await manager.softRemove(Product, product);
    });
  }

  // ══════════════════════════ التحقق ══════════════════════════

  private async assertReferences(
    tenantId: string,
    refs: {
      categoryId?: string | null;
      baseUnitId?: string;
      taxRateId?: string;
    },
  ): Promise<void> {
    // findX يرمي 404 إذا لم يكن السجل تابعاً لنفس الشركة (عزل الشركات)
    await Promise.all([
      refs.categoryId
        ? this.settings.findCategory(refs.categoryId, tenantId)
        : null,
      refs.baseUnitId
        ? this.settings.findUnit(refs.baseUnitId, tenantId)
        : null,
      refs.taxRateId
        ? this.settings.findTaxRate(refs.taxRateId, tenantId)
        : null,
    ]);
  }

  private assertPricing(salePrice: number, minSalePrice?: number | null): void {
    if (
      minSalePrice !== null &&
      minSalePrice !== undefined &&
      minSalePrice > salePrice
    ) {
      throw new BadRequestException('أقل سعر بيع لا يمكن أن يتجاوز سعر البيع');
    }
  }

  private async assertUnitsValid(
    units: ProductUnitDto[],
    baseUnitId: string,
    tenantId: string,
  ): Promise<void> {
    const unitIds = units.map((u) => u.unitId);

    if (unitIds.includes(baseUnitId)) {
      throw new BadRequestException(
        'وحدة الأساس لا تُضاف كوحدة إضافية (معاملها دائماً 1)',
      );
    }
    if (new Set(unitIds).size !== unitIds.length) {
      throw new BadRequestException('لا يمكن تكرار نفس الوحدة للصنف');
    }
    await Promise.all(
      unitIds.map((unitId) => this.settings.findUnit(unitId, tenantId)),
    );
  }

  /** باركود مرتبط بوحدة يجب أن تكون تلك الوحدة من وحدات الصنف */
  private assertBarcodeUnits(
    barcodes: ProductBarcodeDto[],
    units: ProductUnitDto[],
    baseUnitId: string,
  ): void {
    const codes = barcodes.map((b) => b.barcode);
    if (new Set(codes).size !== codes.length) {
      throw new BadRequestException('يوجد باركود مكرر في نفس الصنف');
    }

    const allowed = new Set([baseUnitId, ...units.map((u) => u.unitId)]);
    const invalid = barcodes.find((b) => b.unitId && !allowed.has(b.unitId));
    if (invalid) {
      throw new BadRequestException(
        `الباركود "${invalid.barcode}" مرتبط بوحدة ليست من وحدات الصنف`,
      );
    }
  }

  private async assertSkuFree(
    manager: EntityManager,
    sku: string,
    tenantId: string,
    excludeId?: string,
  ): Promise<string> {
    const existing = await manager.findOne(Product, {
      where: { tenantId, sku },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(
        `كود الصنف "${sku}" مستخدم للصنف "${existing.name}"`,
      );
    }
    return sku;
  }

  /** P-000001, P-000002 ... — يتجاوز أي كود مأخوذ (حتى لو أُدخل يدوياً) */
  private async generateSku(
    manager: EntityManager,
    tenantId: string,
  ): Promise<string> {
    const { max } = (await manager
      .createQueryBuilder(Product, 'product')
      .withDeleted()
      .select(
        `MAX(CAST(SUBSTRING(product.sku FROM ${SKU_PREFIX.length + 1}) AS INTEGER))`,
        'max',
      )
      .where('product.tenantId = :tenantId', { tenantId })
      .andWhere(`product.sku ~ :pattern`, {
        pattern: `^${SKU_PREFIX}[0-9]{1,9}$`,
      })
      .getRawOne<{ max: number | null }>()) ?? { max: null };

    const next = (Number(max) || 0) + 1;
    return `${SKU_PREFIX}${String(next).padStart(SKU_DIGITS, '0')}`;
  }

  // ══════════════════════════ الجداول التابعة ══════════════════════════

  private async replaceUnits(
    manager: EntityManager,
    productId: string,
    tenantId: string,
    units: ProductUnitDto[],
  ): Promise<void> {
    await manager.delete(ProductUnit, { productId, tenantId });
    if (units.length === 0) return;

    await manager.save(
      units.map((unit) =>
        manager.create(ProductUnit, {
          productId,
          tenantId,
          unitId: unit.unitId,
          factor: unit.factor,
          salePrice: unit.salePrice ?? null,
        }),
      ),
    );
  }

  private async replaceBarcodes(
    manager: EntityManager,
    productId: string,
    tenantId: string,
    barcodes: ProductBarcodeDto[],
  ): Promise<void> {
    const codes = barcodes.map((b) => b.barcode);

    if (codes.length > 0) {
      // الباركود فريد داخل الشركة: لا يُسمح باستخدامه لصنف آخر
      const taken = await manager.find(ProductBarcode, {
        where: { tenantId, barcode: In(codes) },
        relations: ['product'],
      });
      const conflict = taken.find((b) => b.productId !== productId);
      if (conflict) {
        throw new ConflictException(
          `الباركود "${conflict.barcode}" مستخدم للصنف "${conflict.product?.name ?? ''}"`,
        );
      }
    }

    await manager.delete(ProductBarcode, { productId, tenantId });
    if (barcodes.length === 0) return;

    await manager.save(
      barcodes.map((item) =>
        manager.create(ProductBarcode, {
          productId,
          tenantId,
          barcode: item.barcode,
          unitId: item.unitId ?? null,
        }),
      ),
    );
  }
}
