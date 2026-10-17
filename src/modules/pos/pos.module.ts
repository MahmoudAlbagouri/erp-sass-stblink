// src/modules/pos/pos.module.ts
import { Injectable, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuotaResolverFor } from '../../common/decorators/quota-resolver.decorator';
import { CatalogModule } from '../catalog/catalog.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SalesModule } from '../sales/sales.module';
import { QuotaResolver } from '../subscriptions/interfaces/quota-resolver.interface';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PosCashier, PosDevice, PosShift } from './entities/pos.entity';
import {
  PosAuditLog,
  PosCashMovement,
  PosPromotion,
} from './entities/pos-extras.entity';
import {
  DiningTable,
  KitchenOrder,
  RestaurantSettings,
} from './entities/restaurant.entity';
import { PosExtrasService } from './pos-extras.service';
import { PosScreenSettingsService } from './pos-screen-settings.service';
import { PosDeviceGuard } from './guards/pos-device.guard';
import { PosCashiersService } from './pos-cashiers.service';
import { PosDeviceController } from './pos-device.controller';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { RestaurantController } from './restaurant.controller';
import { RestaurantService } from './restaurant.service';

/** استهلاك حد الخطة max_pos_devices = عدد أجهزة الكاشير */
@QuotaResolverFor('max_pos_devices')
@Injectable()
export class PosDevicesQuotaResolver implements QuotaResolver {
  constructor(private readonly pos: PosService) {}

  resolve(tenantId: string): Promise<number> {
    return this.pos.countDevices(tenantId);
  }
}

/**
 * موديول نقاط البيع: أجهزة الكاشير، الورديات، ومزامنة الأجهزة (تنزيل بيانات
 * البيع ورفع ما بيع محلياً)، والمطاعم (الطاولات وشاشة المطبخ).
 *
 * لا يملك فواتير: كل بيع يُسجَّل عبر SalesInvoicesService.recordPosSale، فيمرّ
 * بنفس مسار المخزون والترقيم والضريبة كأي فاتورة بيع.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PosDevice,
      PosShift,
      PosCashier,
      PosCashMovement,
      PosAuditLog,
      PosPromotion,
      DiningTable,
      KitchenOrder,
      RestaurantSettings,
    ]),
    JwtModule.register({}), // PosDeviceGuard: جلسة المستخدم الاختيارية
    CatalogModule, // ProductsService, CatalogSettingsService
    InventoryModule, // WarehousesService
    SalesModule, // SalesInvoicesService, CustomersService, SalesSettingsService
    SubscriptionsModule, // SubscriptionGuard
    DeliveryModule, // البيع "توصيل" من الكاشير
  ],
  controllers: [PosController, PosDeviceController, RestaurantController],
  providers: [
    PosService,
    PosCashiersService,
    PosExtrasService,
    PosScreenSettingsService,
    RestaurantService,
    PosDeviceGuard,
    PosDevicesQuotaResolver,
  ],
})
export class PosModule {}
