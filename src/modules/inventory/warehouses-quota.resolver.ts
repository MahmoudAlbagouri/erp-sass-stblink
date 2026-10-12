// src/modules/inventory/warehouses-quota.resolver.ts
import { Injectable } from '@nestjs/common';
import { QuotaResolverFor } from '../../common/decorators/quota-resolver.decorator';
import { QuotaResolver } from '../subscriptions/interfaces/quota-resolver.interface';
import { WarehousesService } from './warehouses.service';

/** استهلاك حد الخطة max_warehouses = عدد مخازن الشركة (الرئيسي + الفروع) */
@QuotaResolverFor('max_warehouses')
@Injectable()
export class WarehousesQuotaResolver implements QuotaResolver {
  constructor(private readonly warehouses: WarehousesService) {}

  resolve(tenantId: string): Promise<number> {
    return this.warehouses.countActive(tenantId);
  }
}
