// src/modules/catalog/catalog.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { CatalogSettingsController } from './catalog-settings.controller';
import { CatalogSettingsService } from './catalog-settings.service';
import { ProductBarcode } from './entities/product-barcode.entity';
import { ProductCategory } from './entities/product-category.entity';
import { ProductUnit } from './entities/product-unit.entity';
import { Product } from './entities/product.entity';
import { TaxRate } from './entities/tax-rate.entity';
import { Unit } from './entities/unit.entity';
import { ProductsQuotaResolver } from './products-quota.resolver';
import { ProductsImportService } from './products-import.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/**
 * موديول الأصناف: المنتجات، التصنيفات، الوحدات، الباركود، الضرائب.
 *
 * هو أساس الموديولات التجارية ولا يعتمد على أي منها. المخزون والمشتريات
 * والمبيعات تتعامل مع الأصناف عبر الخدمات المُصدَّرة هنا فقط — لا تلمس
 * جداوله مباشرة.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Product,
      ProductCategory,
      Unit,
      TaxRate,
      ProductBarcode,
      ProductUnit,
    ]),
    SubscriptionsModule, // SubscriptionGuard
  ],
  controllers: [
    // CatalogSettingsController أولاً: مساراته الثابتة (categories/units/...)
    // لا تتعارض مع products/:id لكن الترتيب يبقيها واضحة
    CatalogSettingsController,
    ProductsController,
  ],
  providers: [
    CatalogSettingsService,
    ProductsService,
    ProductsImportService,
    ProductsQuotaResolver,
  ],
  exports: [CatalogSettingsService, ProductsService, ProductsImportService],
})
export class CatalogModule {}
