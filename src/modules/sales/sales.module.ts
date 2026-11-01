// src/modules/sales/sales.module.ts
import { Injectable, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuotaResolverFor } from '../../common/decorators/quota-resolver.decorator';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryModule } from '../inventory/inventory.module';
import { QuotaResolver } from '../subscriptions/interfaces/quota-resolver.interface';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { CustomerPaymentsController } from './customer-payments.controller';
import { CustomerPaymentsService } from './customer-payments.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerPayment } from './entities/customer-payment.entity';
import { Customer } from './entities/customer.entity';
import {
  SalesInvoice,
  SalesInvoiceLine,
} from './entities/sales-invoice.entity';
import { SalesQuote } from './entities/sales-quote.entity';
import { SalesReturn, SalesReturnLine } from './entities/sales-return.entity';
import { SalesSettings } from './entities/sales-settings.entity';
import { SalesInvoicesController } from './sales-invoices.controller';
import { SalesInvoicesService } from './sales-invoices.service';
import { SalesQuotesController } from './sales-quotes.controller';
import { SalesQuotesService } from './sales-quotes.service';
import { SalesReturnsController } from './sales-returns.controller';
import { SalesReturnsService } from './sales-returns.service';
import { SalesSettingsService } from './sales-settings.service';

/** استهلاك حد الخطة max_invoices = فواتير البيع الصادرة في الشهر الحالي */
@QuotaResolverFor('max_invoices')
@Injectable()
export class SalesInvoicesQuotaResolver implements QuotaResolver {
  constructor(private readonly invoices: SalesInvoicesService) {}

  resolve(tenantId: string): Promise<number> {
    return this.invoices.countIssuedThisMonth(tenantId);
  }
}

/**
 * موديول المبيعات: العملاء وكشوف حساباتهم، فواتير البيع (ترقيم تسلسلي + QR
 * هيئة الزكاة والضريبة)، عروض الأسعار، مرتجعات البيع، والمقبوضات.
 *
 * يعتمد على الأصناف والمخزون: البضاعة تخرج وتعود عبر StockService.apply فقط.
 * شاشة الكاشير (نقاط البيع) تُبنى فوق خدماته المُصدَّرة.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Customer,
      SalesSettings,
      SalesInvoice,
      SalesInvoiceLine,
      SalesQuote,
      SalesReturn,
      SalesReturnLine,
      CustomerPayment,
    ]),
    CatalogModule, // ProductsService
    InventoryModule, // StockService, WarehousesService
    SubscriptionsModule, // SubscriptionGuard
  ],
  controllers: [
    // SalesInvoicesController أولاً: مساره الثابت "summary" قبل أي ":id"
    SalesInvoicesController,
    SalesQuotesController,
    CustomersController,
    SalesReturnsController,
    CustomerPaymentsController,
  ],
  providers: [
    CustomersService,
    SalesSettingsService,
    SalesInvoicesService,
    SalesQuotesService,
    SalesReturnsService,
    CustomerPaymentsService,
    SalesInvoicesQuotaResolver,
  ],
  exports: [
    CustomersService,
    SalesSettingsService,
    SalesInvoicesService,
    SalesQuotesService,
    SalesReturnsService,
    CustomerPaymentsService,
  ],
})
export class SalesModule {}
