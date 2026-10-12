// src/modules/inventory/stock.controller.ts
// الأرصدة، دفتر الحركات، والتسويات اليدوية.
import {
  Body,
  Controller,
  Get,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
  CreateAdjustmentDto,
  MovementQueryDto,
  SetMinQuantityDto,
  StockQueryDto,
} from './dto/inventory.dto';
import { StockService } from './stock.service';

@Controller('inventory')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.INVENTORY_MODULE)
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('stock')
  @Permissions(PERMS.INVENTORY_VIEW)
  findLevels(
    @Query() query: StockQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.stock.findLevels(tenantId, query);
  }

  @Get('stock/summary')
  @Permissions(PERMS.INVENTORY_VIEW)
  summary(
    @CurrentTenantId() tenantId: string,
    @Query('warehouseId', new ParseUUIDPipe({ optional: true }))
    warehouseId?: string,
  ) {
    return this.stock.summary(tenantId, warehouseId);
  }

  /** بحث أصناف لإضافتها في مستند مخزني، مع رصيدها في المخزن المحدد */
  @Get('stock/lookup')
  @Permissions(PERMS.INVENTORY_VIEW)
  lookup(
    @CurrentTenantId() tenantId: string,
    @Query('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Query('search') search?: string,
  ) {
    return this.stock.lookup(tenantId, warehouseId, search);
  }

  @Patch('stock/min-quantity')
  @Permissions(PERMS.STOCK_ADJUST)
  setMinQuantity(
    @Body() dto: SetMinQuantityDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.stock.setMinQuantity(dto, tenantId);
  }

  @Get('movements')
  @Permissions(PERMS.INVENTORY_VIEW)
  findMovements(
    @Query() query: MovementQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.stock.findMovements(tenantId, query);
  }

  @Post('adjustments')
  @Permissions(PERMS.STOCK_ADJUST)
  adjust(
    @Body() dto: CreateAdjustmentDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.stock.adjust(dto, tenantId, userId);
  }
}
