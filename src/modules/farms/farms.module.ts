// src/modules/farms/farms.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryModule } from '../inventory/inventory.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { CropsController } from './crops.controller';
import { CropsService } from './crops.service';
import { Crop, CropCalendarStep, CropVariety } from './entities/crop.entity';
import {
  Farm,
  FarmUnit,
  FarmWaterSource,
  FarmWeatherLog,
} from './entities/farm.entity';
import {
  FarmHarvest,
  FarmInspection,
  FarmOperation,
  FarmOperationInput,
  FarmOperationPlant,
  FarmOperationWorker,
  FarmTransaction,
} from './entities/farm-work.entity';
import {
  FarmPlant,
  FarmPlantStatusLog,
  Planting,
} from './entities/planting.entity';
import { FarmFieldController } from './farm-field.controller';
import { FarmFieldService } from './farm-field.service';
import { FarmHarvestsController } from './farm-harvests.controller';
import { FarmHarvestsService } from './farm-harvests.service';
import { FarmInspectionsController } from './farm-inspections.controller';
import { FarmInspectionsService } from './farm-inspections.service';
import { FarmOperationsController } from './farm-operations.controller';
import { FarmOperationsService } from './farm-operations.service';
import { FarmPlanService } from './farm-plan.service';
import { FarmPlantsController } from './farm-plants.controller';
import { FarmReportsController } from './farm-reports.controller';
import { FarmReportsService } from './farm-reports.service';
import { FarmsController } from './farms.controller';
import { FarmsService } from './farms.service';
import { PlantingsController } from './plantings.controller';
import { PlantingsService } from './plantings.service';

/**
 * إدارة المزارع: الأرض وشجرة وحداتها على الخريطة، المحاصيل وأصنافها،
 * الزراعات وسجل النخيل، العمليات ومدخلاتها، الحصاد، الآفات، والتقارير.
 *
 * يحرّك المخزون عبر StockService.apply وحده (صرف المدخلات ودخول الحصاد)،
 * ويسجّل لكل حدث بقيمته FarmTransaction يرحّله المحرك المحاسبي.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Farm,
      FarmUnit,
      FarmWaterSource,
      FarmWeatherLog,
      Crop,
      CropVariety,
      CropCalendarStep,
      Planting,
      FarmPlant,
      FarmPlantStatusLog,
      FarmOperation,
      FarmOperationInput,
      FarmOperationWorker,
      FarmOperationPlant,
      FarmHarvest,
      FarmInspection,
      FarmTransaction,
    ]),
    InventoryModule,
    SubscriptionsModule, // SubscriptionGuard
  ],
  controllers: [
    FarmsController,
    CropsController,
    PlantingsController,
    FarmPlantsController,
    FarmOperationsController,
    FarmHarvestsController,
    FarmInspectionsController,
    FarmFieldController,
    FarmReportsController,
  ],
  providers: [
    FarmsService,
    CropsService,
    FarmPlanService,
    PlantingsService,
    FarmOperationsService,
    FarmHarvestsService,
    FarmInspectionsService,
    FarmFieldService,
    FarmReportsService,
  ],
})
export class FarmsModule {}
