// src/modules/manufacturing/manufacturing.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { BomsController } from './boms.controller';
import { BomsService } from './boms.service';
import {
  Bom,
  BomByproduct,
  BomLine,
  BomOperation,
} from './entities/bom.entity';
import {
  ProductionOrder,
  ProductionOrderByproduct,
  ProductionOrderMaterial,
  ProductionOrderOperation,
  ProductionTimeLog,
  ProductionTransaction,
} from './entities/production-order.entity';
import { WorkCenter } from './entities/work-center.entity';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';
import { ProductionOrdersController } from './production-orders.controller';
import { ProductionOrdersService } from './production-orders.service';
import { RecipeConsumptionService } from './recipe-consumption.service';
import { WorkCentersController } from './work-centers.controller';
import { WorkCentersService } from './work-centers.service';

/**
 * إدارة المصانع، وقوائم المكوّنات المشتركة مع المطاعم (الوصفات).
 *
 * يحرّك المخزون عبر StockService.apply وحده، ويصدّر RecipeConsumptionService
 * لموديول المبيعات (خصم مكوّنات الطبق عند بيعه).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkCenter,
      Bom,
      BomLine,
      BomOperation,
      BomByproduct,
      ProductionOrder,
      ProductionOrderMaterial,
      ProductionOrderOperation,
      ProductionOrderByproduct,
      ProductionTimeLog,
      ProductionTransaction,
    ]),
    CatalogModule,
    InventoryModule,
    PurchasingModule, // مسودات الشراء من MRP
    SubscriptionsModule, // SubscriptionGuard
  ],
  controllers: [
    WorkCentersController,
    BomsController,
    ProductionOrdersController,
    PlanningController,
  ],
  providers: [
    WorkCentersService,
    BomsService,
    ProductionOrdersService,
    PlanningService,
    RecipeConsumptionService,
  ],
  exports: [BomsService, RecipeConsumptionService],
})
export class ManufacturingModule {}
