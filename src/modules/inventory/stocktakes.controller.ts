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
  StocktakeQueryDto,
  UpdateStocktakeDto,
} from './dto/inventory.dto';
import { StocktakesService } from './stocktakes.service';

@Controller('inventory/stocktakes')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.INVENTORY_MODULE)
export class StocktakesController {
  constructor(private readonly stocktakes: StocktakesService) {}

  @Get()
  @Permissions(PERMS.INVENTORY_VIEW)
  findAll(
    @Query() query: StocktakeQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.stocktakes.findAll(tenantId, query);
  }

  @Get(':id')
  @Permissions(PERMS.INVENTORY_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.stocktakes.findOne(id, tenantId);
  }

  @Post()
  @Permissions(PERMS.STOCKTAKE_MANAGE)
  create(
    @Body() dto: CreateStocktakeDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.stocktakes.create(dto, tenantId, userId);
  }

  @Patch(':id')
  @Permissions(PERMS.STOCKTAKE_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStocktakeDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.stocktakes.update(id, dto, tenantId);
  }

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
