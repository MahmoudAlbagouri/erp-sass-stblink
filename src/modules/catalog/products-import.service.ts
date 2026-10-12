// src/modules/catalog/products-import.service.ts
import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SubscriptionManagerService } from '../subscriptions/subscription-manager.service';
import { CatalogSettingsService } from './catalog-settings.service';
import {
  ImportProductItemDto,
  ImportProductsDto,
} from './dto/import-products.dto';
import { Product } from './entities/product.entity';
import { ProductsService } from './products.service';

const DEFAULT_UNIT = 'قطعة';

export interface ImportedProduct {
  id: string;
  name: string;
  sku: string;
}

export interface ImportProductsResult {
  created: ImportedProduct[];
  /** أصناف موجودة بنفس الاسم (أو مكررة في الطلب) فلم تُضف */
  skipped: string[];
  /** أصناف رُفضت مع السبب (باركود مستخدم، كود مكرر...) */
  failed: { name: string; reason: string }[];
  categoriesCreated: string[];
  unitsCreated: string[];
}

/**
 * استيراد أصناف دفعة واحدة (قائمة أسعار عميل جديد مثلاً).
 *
 * - التصنيفات والوحدات تُكتب بالاسم وتُنشأ إن لم تكن موجودة.
 * - آمن للتكرار: الصنف الموجود باسمه يُتخطى، فإعادة إرسال نفس القائمة لا
 *   تكرّر شيئاً.
 * - كل صنف يُنشأ بنفس مسار الإضافة العادي (نفس التحقق وتوليد الكود)، وفشل
 *   صنف لا يوقف الباقي: يعود في `failed` مع سببه.
 * - حدّ الخطة يُفحص للدفعة كلها قبل البدء: إما تدخل كلها أو لا يدخل شيء.
 */
@Injectable()
export class ProductsImportService {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    private readonly productsService: ProductsService,
    private readonly settings: CatalogSettingsService,
    private readonly subscriptions: SubscriptionManagerService,
  ) {}

  async import(
    dto: ImportProductsDto,
    tenantId: string,
  ): Promise<ImportProductsResult> {
    const result: ImportProductsResult = {
      created: [],
      skipped: [],
      failed: [],
      categoriesCreated: [],
      unitsCreated: [],
    };

    const items = await this.newItemsOnly(dto.items, tenantId, result);
    if (items.length === 0) return result;

    await this.assertWithinPlan(tenantId, items.length);

    const taxRateId =
      dto.taxRateId ?? (await this.settings.getDefaultTaxRate(tenantId)).id;
    if (dto.taxRateId) await this.settings.findTaxRate(dto.taxRateId, tenantId);

    const defaultUnit = dto.defaultUnit?.trim() || DEFAULT_UNIT;
    const unitIds = await this.resolveUnits(
      items.map((item) => item.unit?.trim() || defaultUnit),
      tenantId,
      result,
    );
    const categoryIds = await this.resolveCategories(
      items
        .map((item) => item.category?.trim())
        .filter((c): c is string => !!c),
      tenantId,
      result,
    );

    for (const item of items) {
      try {
        const product = await this.productsService.create(
          {
            name: item.name.trim(),
            sku: item.sku,
            categoryId: item.category
              ? categoryIds.get(item.category.trim())
              : undefined,
            baseUnitId: unitIds.get(item.unit?.trim() || defaultUnit)!,
            taxRateId,
            salePrice: item.salePrice,
            minSalePrice: item.minSalePrice,
            priceIncludesTax: dto.priceIncludesTax ?? true,
            barcodes: item.barcode ? [{ barcode: item.barcode }] : [],
          },
          tenantId,
        );
        result.created.push({
          id: product.id,
          name: product.name,
          sku: product.sku,
        });
      } catch (error) {
        result.failed.push({
          name: item.name,
          reason: error instanceof Error ? error.message : 'خطأ غير متوقع',
        });
      }
    }
    return result;
  }

  /** يستبعد المكرر داخل الطلب والموجود في الشركة (بالاسم) */
  private async newItemsOnly(
    items: ImportProductItemDto[],
    tenantId: string,
    result: ImportProductsResult,
  ): Promise<ImportProductItemDto[]> {
    const unique = new Map<string, ImportProductItemDto>();
    for (const item of items) {
      const name = item.name.trim();
      if (unique.has(name)) result.skipped.push(name);
      else unique.set(name, item);
    }

    const existing = await this.products.find({
      where: { tenantId, name: In([...unique.keys()]) },
      select: { name: true },
    });
    for (const { name } of existing) {
      unique.delete(name);
      result.skipped.push(name);
    }
    return [...unique.values()];
  }

  private async assertWithinPlan(
    tenantId: string,
    count: number,
  ): Promise<void> {
    const quota = await this.subscriptions.checkQuota(tenantId, 'max_products');
    if (quota.remaining !== null && count > quota.remaining) {
      throw new ForbiddenException(
        `الخطة تسمح بإضافة ${quota.remaining} صنفاً فقط (الحد ${quota.limit} والمستخدم ${quota.used})، والقائمة فيها ${count} صنفاً جديداً. لم يُضف شيء — قم بترقية الخطة أو قلّل القائمة.`,
      );
    }
  }

  /** اسم الوحدة ← معرّفها، مع إنشاء غير الموجود */
  private async resolveUnits(
    names: string[],
    tenantId: string,
    result: ImportProductsResult,
  ): Promise<Map<string, string>> {
    const units = await this.settings.findUnits(tenantId);
    const ids = new Map(units.map((u) => [u.name, u.id]));

    for (const name of new Set(names)) {
      if (ids.has(name)) continue;
      const unit = await this.settings.createUnit({ name }, tenantId);
      ids.set(name, unit.id);
      result.unitsCreated.push(name);
    }
    return ids;
  }

  /** اسم التصنيف ← معرّفه، مع إنشاء غير الموجود */
  private async resolveCategories(
    names: string[],
    tenantId: string,
    result: ImportProductsResult,
  ): Promise<Map<string, string>> {
    const categories = await this.settings.findCategories(tenantId);
    const ids = new Map(categories.map((c) => [c.name, c.id]));

    for (const name of new Set(names)) {
      if (ids.has(name)) continue;
      const category = await this.settings.createCategory({ name }, tenantId);
      ids.set(name, category.id);
      result.categoriesCreated.push(name);
    }
    return ids;
  }
}
