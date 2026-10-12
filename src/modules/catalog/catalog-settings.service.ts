// src/modules/catalog/catalog-settings.service.ts
// إعدادات الأصناف: التصنيفات، الوحدات، الضرائب.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import {
  CreateCategoryDto,
  CreateTaxRateDto,
  CreateUnitDto,
  UpdateCategoryDto,
  UpdateTaxRateDto,
  UpdateUnitDto,
} from './dto/catalog-settings.dto';
import { ProductCategory } from './entities/product-category.entity';
import { Product } from './entities/product.entity';
import { TaxCategory, TaxRate } from './entities/tax-rate.entity';
import { Unit } from './entities/unit.entity';

/** القيم التي تبدأ بها أي شركة جديدة (تُنشأ عند أول استخدام) */
const DEFAULT_UNITS: Pick<Unit, 'name' | 'symbol' | 'allowsFractions'>[] = [
  { name: 'قطعة', symbol: 'قطعة', allowsFractions: false },
  { name: 'كرتون', symbol: 'كرتون', allowsFractions: false },
  { name: 'علبة', symbol: 'علبة', allowsFractions: false },
  { name: 'كيلوجرام', symbol: 'كجم', allowsFractions: true },
  { name: 'لتر', symbol: 'لتر', allowsFractions: true },
  { name: 'متر', symbol: 'م', allowsFractions: true },
];

const DEFAULT_TAX_RATES: Pick<
  TaxRate,
  'name' | 'rate' | 'category' | 'isDefault'
>[] = [
  {
    name: 'ضريبة القيمة المضافة 15%',
    rate: 15,
    category: TaxCategory.STANDARD,
    isDefault: true,
  },
  {
    name: 'نسبة صفرية 0%',
    rate: 0,
    category: TaxCategory.ZERO_RATED,
    isDefault: false,
  },
  {
    name: 'معفى من الضريبة',
    rate: 0,
    category: TaxCategory.EXEMPT,
    isDefault: false,
  },
];

@Injectable()
export class CatalogSettingsService {
  constructor(
    @InjectRepository(ProductCategory)
    private readonly categories: Repository<ProductCategory>,
    @InjectRepository(Unit) private readonly units: Repository<Unit>,
    @InjectRepository(TaxRate) private readonly taxRates: Repository<TaxRate>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
  ) {}

  // ══════════════════════════ التصنيفات ══════════════════════════

  findCategories(tenantId: string): Promise<ProductCategory[]> {
    return this.categories.find({
      where: { tenantId },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async findCategory(id: string, tenantId: string): Promise<ProductCategory> {
    const category = await this.categories.findOne({ where: { id, tenantId } });
    if (!category) throw new NotFoundException('التصنيف غير موجود');
    return category;
  }

  async createCategory(
    dto: CreateCategoryDto,
    tenantId: string,
  ): Promise<ProductCategory> {
    const parentId = dto.parentId ?? null;
    if (parentId) await this.findCategory(parentId, tenantId);
    await this.assertCategoryNameFree(dto.name, parentId, tenantId);

    return this.categories.save(
      this.categories.create({ ...dto, parentId, tenantId }),
    );
  }

  async updateCategory(
    id: string,
    dto: UpdateCategoryDto,
    tenantId: string,
  ): Promise<ProductCategory> {
    const category = await this.findCategory(id, tenantId);
    const parentId =
      dto.parentId === undefined ? category.parentId : dto.parentId;

    if (parentId && parentId !== category.parentId) {
      await this.assertNotDescendant(id, parentId, tenantId);
    }
    if (
      (dto.name && dto.name !== category.name) ||
      parentId !== category.parentId
    ) {
      await this.assertCategoryNameFree(
        dto.name ?? category.name,
        parentId ?? null,
        tenantId,
        id,
      );
    }

    Object.assign(category, dto, { parentId: parentId ?? null });
    return this.categories.save(category);
  }

  async removeCategory(id: string, tenantId: string): Promise<void> {
    const category = await this.findCategory(id, tenantId);

    const [children, products] = await Promise.all([
      this.categories.count({ where: { tenantId, parentId: id } }),
      this.products.count({ where: { tenantId, categoryId: id } }),
    ]);
    if (children > 0) {
      throw new ConflictException(
        `لا يمكن حذف التصنيف لوجود ${children} تصنيف فرعي تحته`,
      );
    }
    if (products > 0) {
      throw new ConflictException(
        `لا يمكن حذف التصنيف لوجود ${products} صنف مرتبط به`,
      );
    }

    await this.categories.softRemove(category);
  }

  private async assertCategoryNameFree(
    name: string,
    parentId: string | null,
    tenantId: string,
    excludeId?: string,
  ): Promise<void> {
    const duplicate = await this.categories.findOne({
      where: {
        tenantId,
        name,
        parentId: parentId ?? IsNull(),
        ...(excludeId ? { id: Not(excludeId) } : {}),
      },
    });
    if (duplicate) {
      throw new ConflictException(`يوجد تصنيف بنفس الاسم "${name}"`);
    }
  }

  /** يمنع جعل التصنيف ابناً لنفسه أو لأحد فروعه (حلقة لا نهائية في الشجرة) */
  private async assertNotDescendant(
    categoryId: string,
    newParentId: string,
    tenantId: string,
  ): Promise<void> {
    let cursor: string | null | undefined = newParentId;
    const visited = new Set<string>();

    while (cursor) {
      if (cursor === categoryId) {
        throw new BadRequestException(
          'لا يمكن نقل التصنيف تحت نفسه أو تحت أحد فروعه',
        );
      }
      if (visited.has(cursor)) break;
      visited.add(cursor);

      const parent: ProductCategory = await this.findCategory(cursor, tenantId);
      cursor = parent.parentId;
    }
  }

  // ══════════════════════════ الوحدات ══════════════════════════

  async findUnits(tenantId: string): Promise<Unit[]> {
    await this.ensureDefaults(tenantId);
    return this.units.find({ where: { tenantId }, order: { name: 'ASC' } });
  }

  async findUnit(id: string, tenantId: string): Promise<Unit> {
    const unit = await this.units.findOne({ where: { id, tenantId } });
    if (!unit) throw new NotFoundException('الوحدة غير موجودة');
    return unit;
  }

  async createUnit(dto: CreateUnitDto, tenantId: string): Promise<Unit> {
    await this.assertUnitNameFree(dto.name, tenantId);
    return this.units.save(this.units.create({ ...dto, tenantId }));
  }

  async updateUnit(
    id: string,
    dto: UpdateUnitDto,
    tenantId: string,
  ): Promise<Unit> {
    const unit = await this.findUnit(id, tenantId);
    if (dto.name && dto.name !== unit.name) {
      await this.assertUnitNameFree(dto.name, tenantId, id);
    }
    Object.assign(unit, dto);
    return this.units.save(unit);
  }

  async removeUnit(id: string, tenantId: string): Promise<void> {
    const unit = await this.findUnit(id, tenantId);

    const usedBy = await this.products
      .createQueryBuilder('product')
      .leftJoin('product.units', 'productUnit')
      .where('product.tenantId = :tenantId', { tenantId })
      .andWhere('(product.baseUnitId = :id OR productUnit.unitId = :id)', {
        id,
      })
      .getCount();
    if (usedBy > 0) {
      throw new ConflictException(
        `لا يمكن حذف الوحدة لأنها مستخدمة في ${usedBy} صنف`,
      );
    }

    await this.units.softRemove(unit);
  }

  private async assertUnitNameFree(
    name: string,
    tenantId: string,
    excludeId?: string,
  ): Promise<void> {
    const duplicate = await this.units.findOne({
      where: { tenantId, name, ...(excludeId ? { id: Not(excludeId) } : {}) },
    });
    if (duplicate)
      throw new ConflictException(`الوحدة "${name}" موجودة بالفعل`);
  }

  // ══════════════════════════ الضرائب ══════════════════════════

  async findTaxRates(tenantId: string): Promise<TaxRate[]> {
    await this.ensureDefaults(tenantId);
    return this.taxRates.find({
      where: { tenantId },
      order: { isDefault: 'DESC', rate: 'DESC' },
    });
  }

  async findTaxRate(id: string, tenantId: string): Promise<TaxRate> {
    const taxRate = await this.taxRates.findOne({ where: { id, tenantId } });
    if (!taxRate) throw new NotFoundException('الضريبة غير موجودة');
    return taxRate;
  }

  /** الضريبة الافتراضية للأصناف الجديدة */
  async getDefaultTaxRate(tenantId: string): Promise<TaxRate> {
    await this.ensureDefaults(tenantId);
    const taxRate =
      (await this.taxRates.findOne({ where: { tenantId, isDefault: true } })) ??
      (await this.taxRates.findOne({
        where: { tenantId },
        order: { rate: 'DESC' },
      }));
    if (!taxRate) throw new NotFoundException('لا توجد ضريبة معرّفة للشركة');
    return taxRate;
  }

  async createTaxRate(
    dto: CreateTaxRateDto,
    tenantId: string,
  ): Promise<TaxRate> {
    await this.assertTaxNameFree(dto.name, tenantId);
    if (dto.isDefault) await this.clearDefaultTax(tenantId);
    return this.taxRates.save(this.taxRates.create({ ...dto, tenantId }));
  }

  async updateTaxRate(
    id: string,
    dto: UpdateTaxRateDto,
    tenantId: string,
  ): Promise<TaxRate> {
    const taxRate = await this.findTaxRate(id, tenantId);
    if (dto.name && dto.name !== taxRate.name) {
      await this.assertTaxNameFree(dto.name, tenantId, id);
    }
    if (dto.isDefault && !taxRate.isDefault) {
      await this.clearDefaultTax(tenantId);
    }
    Object.assign(taxRate, dto);
    return this.taxRates.save(taxRate);
  }

  async removeTaxRate(id: string, tenantId: string): Promise<void> {
    const taxRate = await this.findTaxRate(id, tenantId);

    const usedBy = await this.products.count({
      where: { tenantId, taxRateId: id },
    });
    if (usedBy > 0) {
      throw new ConflictException(
        `لا يمكن حذف الضريبة لأنها مستخدمة في ${usedBy} صنف`,
      );
    }

    await this.taxRates.softRemove(taxRate);
  }

  private async assertTaxNameFree(
    name: string,
    tenantId: string,
    excludeId?: string,
  ): Promise<void> {
    const duplicate = await this.taxRates.findOne({
      where: { tenantId, name, ...(excludeId ? { id: Not(excludeId) } : {}) },
    });
    if (duplicate) {
      throw new ConflictException(`الضريبة "${name}" موجودة بالفعل`);
    }
  }

  private async clearDefaultTax(tenantId: string): Promise<void> {
    await this.taxRates.update(
      { tenantId, isDefault: true },
      { isDefault: false },
    );
  }

  // ══════════════════════════ القيم الافتراضية ══════════════════════════

  /**
   * ينشئ الوحدات والضرائب الأساسية لشركة لم تُعرّف شيئاً بعد.
   * يعتمد على العدّ شاملاً المحذوف: شركة حذفت كل وحداتها عمداً لا نعيد
   * إنشاءها لها.
   *
   * الإدراج بـ ON CONFLICT DO NOTHING: صفحة الأصناف تطلب الوحدات والضرائب
   * والتصنيفات معاً، فتصل عدة طلبات لشركة جديدة في نفس اللحظة وكلها ترى
   * العدّ صفراً. الفهرس الفريد (الشركة + الاسم) يجعل الأول يُدرج والباقي
   * يمرّ بلا خطأ.
   */
  async ensureDefaults(tenantId: string): Promise<void> {
    const [unitCount, taxCount] = await Promise.all([
      this.units.count({ where: { tenantId }, withDeleted: true }),
      this.taxRates.count({ where: { tenantId }, withDeleted: true }),
    ]);

    if (unitCount === 0) {
      await this.units
        .createQueryBuilder()
        .insert()
        .values(DEFAULT_UNITS.map((unit) => ({ ...unit, tenantId })))
        .orIgnore()
        .execute();
    }
    if (taxCount === 0) {
      await this.taxRates
        .createQueryBuilder()
        .insert()
        .values(DEFAULT_TAX_RATES.map((tax) => ({ ...tax, tenantId })))
        .orIgnore()
        .execute();
    }
  }
}
