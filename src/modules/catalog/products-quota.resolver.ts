// src/modules/catalog/products-quota.resolver.ts
import { Injectable } from '@nestjs/common';
import { QuotaResolverFor } from '../../common/decorators/quota-resolver.decorator';
import { QuotaResolver } from '../subscriptions/interfaces/quota-resolver.interface';
import { ProductsService } from './products.service';

/** استهلاك حد الخطة max_products = عدد أصناف الشركة (غير المحذوفة) */
@QuotaResolverFor('max_products')
@Injectable()
export class ProductsQuotaResolver implements QuotaResolver {
  constructor(private readonly productsService: ProductsService) {}

  resolve(tenantId: string): Promise<number> {
    return this.productsService.countActive(tenantId);
  }
}
