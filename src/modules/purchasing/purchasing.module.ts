// src/modules/purchasing/purchasing.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import {
  PurchaseInvoice,
  PurchaseInvoiceLine,
} from './entities/purchase-invoice.entity';
import {
  PurchaseReturn,
  PurchaseReturnLine,
} from './entities/purchase-return.entity';
import { SupplierPayment } from './entities/supplier-payment.entity';
import { Supplier } from './entities/supplier.entity';
import { PurchaseInvoicesController } from './purchase-invoices.controller';
import { PurchaseInvoicesService } from './purchase-invoices.service';
import { PurchaseReturnsController } from './purchase-returns.controller';
import { PurchaseReturnsService } from './purchase-returns.service';
import { SupplierPaymentsController } from './supplier-payments.controller';
import { SupplierPaymentsService } from './supplier-payments.service';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

/**
 * موديول المشتريات والموردين: الموردون وكشوف حساباتهم، فواتير الشراء،
 * مرتجعات الشراء، والسداد.
 *
 * يعتمد على الأصناف (الأصناف، الوحدات، الضرائب) وعلى المخزون: البضاعة تدخل
 * وتخرج عبر StockService.apply فقط — لا يكتب في جداول المخزون مباشرة.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Supplier,
      PurchaseInvoice,
      PurchaseInvoiceLine,
      PurchaseReturn,
      PurchaseReturnLine,
      SupplierPayment,
    ]),
    CatalogModule, // ProductsService, CatalogSettingsService
    InventoryModule, // StockService, WarehousesService
    SubscriptionsModule, // SubscriptionGuard
  ],
  controllers: [
    SuppliersController,
    PurchaseInvoicesController,
    PurchaseReturnsController,
    SupplierPaymentsController,
  ],
  providers: [
    SuppliersService,
    PurchaseInvoicesService,
    PurchaseReturnsService,
    SupplierPaymentsService,
  ],
  exports: [SuppliersService],
})
export class PurchasingModule {}
