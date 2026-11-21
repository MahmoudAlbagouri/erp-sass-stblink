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
import {
  StockLot,
  StockLotLevel,
  StockMovementLot,
} from './entities/stock-lot.entity';
import { LotsController } from './lots.controller';
import { LotsService } from './lots.service';
import { StockLotsService } from './stock-lots.service';
import { StockController } from './stock.controller';
import { StockImportService } from './stock-import.service';
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
      StockLot,
      StockLotLevel,
      StockMovementLot,
    ]),
    CatalogModule, // ProductsService
    SubscriptionsModule, // SubscriptionGuard
  ],
  controllers: [
    WarehousesController,
    StockController,
    TransfersController,
    StocktakesController,
    LotsController,
  ],
  providers: [
    WarehousesService,
    StockService,
    StockImportService,
    TransfersService,
    StocktakesService,
    WarehousesQuotaResolver,
    StockLotsService,
    LotsService,
  ],
  exports: [WarehousesService, StockService, StockLotsService, LotsService],
})
export class InventoryModule {}
