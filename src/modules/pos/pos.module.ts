// src/modules/pos/pos.module.ts
import { Injectable, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuotaResolverFor } from '../../common/decorators/quota-resolver.decorator';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SalesModule } from '../sales/sales.module';
import { QuotaResolver } from '../subscriptions/interfaces/quota-resolver.interface';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PosDevice, PosShift } from './entities/pos.entity';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

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
 * البيع ورفع ما بيع محلياً).
 *
 * لا يملك فواتير: كل بيع يُسجَّل عبر SalesInvoicesService.recordPosSale، فيمرّ
 * بنفس مسار المخزون والترقيم والضريبة كأي فاتورة بيع.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([PosDevice, PosShift]),
    CatalogModule, // ProductsService, CatalogSettingsService
    InventoryModule, // WarehousesService
    SalesModule, // SalesInvoicesService, CustomersService, SalesSettingsService
    SubscriptionsModule, // SubscriptionGuard
  ],
  controllers: [PosController],
  providers: [PosService, PosDevicesQuotaResolver],
})
export class PosModule {}
