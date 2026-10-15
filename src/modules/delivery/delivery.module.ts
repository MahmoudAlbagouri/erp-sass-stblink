// src/modules/delivery/delivery.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { SalesModule } from '../sales/sales.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import {
  DeliveryAgent,
  DeliveryOrder,
  DeliverySettlement,
  DeliveryZone,
} from './entities/delivery.entity';

/**
 * التوصيل والشحن: أوردرات تخرج مع طيار المحل أو شركة شحن، وتسوية ما حصّلته
 * كل جهة.
 *
 * لا يملك فواتير: كل أوردر خلفه فاتورة بيع عبر SalesInvoicesService، فيمرّ
 * بنفس مسار المخزون والترقيم والضريبة، والأوردر الذي لم يُسلَّم يُرجَع
 * بمرتجع بيع عبر SalesReturnsService. التوثيق: docs/modules/delivery.md
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeliveryAgent,
      DeliveryZone,
      DeliveryOrder,
      DeliverySettlement,
    ]),
    CatalogModule, // ProductsService (صنف رسوم التوصيل)
    SalesModule, // SalesInvoicesService, SalesReturnsService
    SubscriptionsModule, // SubscriptionGuard
  ],
  controllers: [DeliveryController],
  providers: [DeliveryService],
})
export class DeliveryModule {}
