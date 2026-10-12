// src/modules/catalog/products.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { FEATURES } from '../../common/constants/features';
import { PERMS } from '../../common/constants/permissions';
import { CheckQuota } from '../../common/decorators/check-quota.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateProductDto,
  ProductQueryDto,
  UpdateProductDto,
} from './dto/product.dto';
import { ProductsService } from './products.service';

@Controller('catalog/products')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.PRODUCTS_MODULE)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @Permissions(PERMS.PRODUCT_CREATE)
  @CheckQuota('max_products')
  create(@Body() dto: CreateProductDto, @CurrentTenantId() tenantId: string) {
    return this.productsService.create(dto, tenantId);
  }

  @Get()
  @Permissions(PERMS.PRODUCT_VIEW)
  findAll(
    @Query() query: ProductQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.productsService.findAll(tenantId, query);
  }

  // قبل ':id' حتى لا يُعامل "barcode" كمعرّف
  @Get('barcode/:barcode')
  @Permissions(PERMS.PRODUCT_VIEW)
  findByBarcode(
    @Param('barcode') barcode: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.productsService.findByBarcode(barcode, tenantId);
  }

  @Get(':id')
  @Permissions(PERMS.PRODUCT_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.productsService.findOne(id, tenantId);
  }

  @Patch(':id')
  @Permissions(PERMS.PRODUCT_UPDATE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.productsService.update(id, dto, tenantId);
  }

  @Delete(':id')
  @Permissions(PERMS.PRODUCT_DELETE)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.productsService.remove(id, tenantId);
  }
}
