// src/modules/catalog/products.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
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
import { ImportProductsDto } from './dto/import-products.dto';
import { ProductsImportService } from './products-import.service';
import { ProductsService } from './products.service';

@ApiTags(apiTag('PRODUCTS'))
@Controller('catalog/products')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.PRODUCTS_MODULE)
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly productsImport: ProductsImportService,
  ) {}

  /**
   * استيراد أصناف دفعة واحدة (حتى 1000). الموجود باسمه يُتخطى، والتصنيفات
   * والوحدات تُنشأ بالاسم. للاستيراد مع رصيد افتتاحي:
   * POST /inventory/stock/import-products
   */
  @Post('import')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.PRODUCT_CREATE, PERMS.CATALOG_SETTINGS_MANAGE)
  importMany(
    @Body() dto: ImportProductsDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.productsImport.import(dto, tenantId);
  }

  /** إضافة صنف */
  @Post()
  @Permissions(PERMS.PRODUCT_CREATE)
  @CheckQuota('max_products')
  create(@Body() dto: CreateProductDto, @CurrentTenantId() tenantId: string) {
    return this.productsService.create(dto, tenantId);
  }

  /** قائمة الأصناف (بحث وفلترة وترقيم) */
  @Get()
  @Permissions(PERMS.PRODUCT_VIEW)
  findAll(
    @Query() query: ProductQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.productsService.findAll(tenantId, query);
  }

  // قبل ':id' حتى لا يُعامل "barcode" كمعرّف
  /** صنف بباركوده */
  @Get('barcode/:barcode')
  @Permissions(PERMS.PRODUCT_VIEW)
  findByBarcode(
    @Param('barcode') barcode: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.productsService.findByBarcode(barcode, tenantId);
  }

  /** صنف واحد بوحداته وباركوداته */
  @Get(':id')
  @Permissions(PERMS.PRODUCT_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.productsService.findOne(id, tenantId);
  }

  /** تعديل صنف */
  @Patch(':id')
  @Permissions(PERMS.PRODUCT_UPDATE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.productsService.update(id, dto, tenantId);
  }

  /** حذف صنف */
  @Delete(':id')
  @Permissions(PERMS.PRODUCT_DELETE)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.productsService.remove(id, tenantId);
  }
}
