// src/modules/inventory/stocktakes.controller.ts
import {
  Body,
  Controller,
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
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateStocktakeDto,
  StocktakeCountsDto,
  StocktakeQueryDto,
  UpdateStocktakeDto,
} from './dto/inventory.dto';
import { StocktakesService } from './stocktakes.service';

@ApiTags(apiTag('STOCKTAKES'))
@Controller('inventory/stocktakes')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.INVENTORY_MODULE)
export class StocktakesController {
  constructor(private readonly stocktakes: StocktakesService) {}

  /** قائمة عمليات الجرد */
  @Get()
  @Permissions(PERMS.INVENTORY_VIEW)
  findAll(
    @Query() query: StocktakeQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.stocktakes.findAll(tenantId, query);
  }

  /** جرد واحد ببنوده (والمسودة تعرض رصيد النظام الحالي) */
  @Get(':id')
  @Permissions(PERMS.INVENTORY_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.stocktakes.findOne(id, tenantId);
  }

  /** بدء جرد (مسودة) */
  @Post()
  @Permissions(PERMS.STOCKTAKE_MANAGE)
  create(
    @Body() dto: CreateStocktakeDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.stocktakes.create(dto, tenantId, userId);
  }

  /** تعديل مسودة جرد (expectedUpdatedAt يمنع مسح ما عُدّ بعد فتحها: 409) */
  @Patch(':id')
  @Permissions(PERMS.STOCKTAKE_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStocktakeDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.stocktakes.update(id, dto, tenantId, userId);
  }

  /** شاشة العدّ: ما عُدّ في الجرد الآن (بلا رصيد النظام) */
  @Get(':id/counts')
  @Permissions(PERMS.INVENTORY_VIEW)
  counts(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.stocktakes.counts(id, tenantId);
  }

  /** شاشة العدّ: رفع العدّ (ربما بعد انقطاع) — كل صنف بكميته ووقت عدّه، والأحدث يكسب */
  @Post(':id/counts')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.STOCKTAKE_MANAGE)
  applyCounts(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StocktakeCountsDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.stocktakes.applyCounts(id, dto, tenantId, userId);
  }

  /** شاشة العدّ: الأصناف المخزنية وباركوداتها للبحث على الجهاز بلا إنترنت */
  @Get(':id/catalog')
  @Permissions(PERMS.STOCKTAKE_MANAGE)
  catalog(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.stocktakes.catalog(id, tenantId);
  }

  /** اعتماد الجرد: تُسوّى الأرصدة على المعدود */
  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.STOCKTAKE_MANAGE)
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.stocktakes.post(id, tenantId, userId);
  }

  /** إلغاء مسودة جرد */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.STOCKTAKE_MANAGE)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.stocktakes.cancel(id, tenantId);
  }
}
