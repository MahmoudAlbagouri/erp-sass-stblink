// src/modules/catalog/catalog-settings.controller.ts
// التصنيفات، الوحدات، الضرائب. القراءة لكل من يرى الأصناف (يحتاجها نموذج
// الصنف والكاشير)، والتعديل بصلاحية إعدادات الأصناف.
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { FEATURES } from '../../common/constants/features';
import { PERMS } from '../../common/constants/permissions';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CatalogSettingsService } from './catalog-settings.service';
import {
  CreateCategoryDto,
  CreateTaxRateDto,
  CreateUnitDto,
  UpdateCategoryDto,
  UpdateTaxRateDto,
  UpdateUnitDto,
} from './dto/catalog-settings.dto';

@Controller('catalog')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.PRODUCTS_MODULE)
export class CatalogSettingsController {
  constructor(private readonly settings: CatalogSettingsService) {}

  // ─── التصنيفات ──────────────────────────────────────────────
  @Get('categories')
  @Permissions(PERMS.PRODUCT_VIEW)
  findCategories(@CurrentTenantId() tenantId: string) {
    return this.settings.findCategories(tenantId);
  }

  @Post('categories')
  @Permissions(PERMS.CATALOG_SETTINGS_MANAGE)
  createCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settings.createCategory(dto, tenantId);
  }

  @Patch('categories/:id')
  @Permissions(PERMS.CATALOG_SETTINGS_MANAGE)
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settings.updateCategory(id, dto, tenantId);
  }

  @Delete('categories/:id')
  @Permissions(PERMS.CATALOG_SETTINGS_MANAGE)
  removeCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settings.removeCategory(id, tenantId);
  }

  // ─── الوحدات ────────────────────────────────────────────────
  @Get('units')
  @Permissions(PERMS.PRODUCT_VIEW)
  findUnits(@CurrentTenantId() tenantId: string) {
    return this.settings.findUnits(tenantId);
  }

  @Post('units')
  @Permissions(PERMS.CATALOG_SETTINGS_MANAGE)
  createUnit(@Body() dto: CreateUnitDto, @CurrentTenantId() tenantId: string) {
    return this.settings.createUnit(dto, tenantId);
  }

  @Patch('units/:id')
  @Permissions(PERMS.CATALOG_SETTINGS_MANAGE)
  updateUnit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUnitDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settings.updateUnit(id, dto, tenantId);
  }

  @Delete('units/:id')
  @Permissions(PERMS.CATALOG_SETTINGS_MANAGE)
  removeUnit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settings.removeUnit(id, tenantId);
  }

  // ─── الضرائب ────────────────────────────────────────────────
  @Get('tax-rates')
  @Permissions(PERMS.PRODUCT_VIEW)
  findTaxRates(@CurrentTenantId() tenantId: string) {
    return this.settings.findTaxRates(tenantId);
  }

  @Post('tax-rates')
  @Permissions(PERMS.CATALOG_SETTINGS_MANAGE)
  createTaxRate(
    @Body() dto: CreateTaxRateDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settings.createTaxRate(dto, tenantId);
  }

  @Patch('tax-rates/:id')
  @Permissions(PERMS.CATALOG_SETTINGS_MANAGE)
  updateTaxRate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaxRateDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settings.updateTaxRate(id, dto, tenantId);
  }

  @Delete('tax-rates/:id')
  @Permissions(PERMS.CATALOG_SETTINGS_MANAGE)
  removeTaxRate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settings.removeTaxRate(id, tenantId);
  }
}
