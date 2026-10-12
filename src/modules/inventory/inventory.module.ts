// src/modules/inventory/inventory.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { InventoryItem } from './entities/inventory-item.entity';
import { StockLevel } from './entities/stock-level.entity';
import { StockMovement } from './entities/stock-movement.entity';
import {
  StockTransfer,
  StockTransferLine,
} from './entities/stock-transfer.entity';
import { Stocktake, StocktakeLine } from './entities/stocktake.entity';
import { Warehouse } from './entities/warehouse.entity';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { StocktakesController } from './stocktakes.controller';
import { StocktakesService } from './stocktakes.service';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { WarehousesQuotaResolver } from './warehouses-quota.resolver';
import { WarehousesController } from './warehouses.controller';
import { WarehousesService } from './warehouses.service';

/**
 * موديول المخزون: المخازن، الأرصدة، دفتر الحركات، التحويلات، الجرد،
 * ومتوسط التكلفة.
 *
 * يعتمد على موديول الأصناف فقط. المشتريات والمبيعات لاحقاً تغيّران المخزون
 * عبر StockService.apply المُصدَّر هنا — لا تكتبان في جداوله مباشرة.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Warehouse,
      StockLevel,
      InventoryItem,
      StockMovement,
      StockTransfer,
      StockTransferLine,
      Stocktake,
      StocktakeLine,
    ]),
    CatalogModule, // ProductsService
    SubscriptionsModule, // SubscriptionGuard
  ],
  controllers: [
    WarehousesController,
    StockController,
    TransfersController,
    StocktakesController,
  ],
  providers: [
    WarehousesService,
    StockService,
    TransfersService,
    StocktakesService,
    WarehousesQuotaResolver,
  ],
  exports: [WarehousesService, StockService],
})
export class InventoryModule {}
