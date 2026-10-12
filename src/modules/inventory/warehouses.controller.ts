// src/modules/inventory/warehouses.controller.ts
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
import { CheckQuota } from '../../common/decorators/check-quota.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateWarehouseDto, UpdateWarehouseDto } from './dto/inventory.dto';
import { WarehousesService } from './warehouses.service';

@Controller('inventory/warehouses')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.INVENTORY_MODULE)
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  @Permissions(PERMS.INVENTORY_VIEW)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.warehouses.findAll(tenantId);
  }

  @Post()
  @Permissions(PERMS.WAREHOUSE_MANAGE)
  @CheckQuota('max_warehouses')
  create(@Body() dto: CreateWarehouseDto, @CurrentTenantId() tenantId: string) {
    return this.warehouses.create(dto, tenantId);
  }

  @Patch(':id')
  @Permissions(PERMS.WAREHOUSE_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.warehouses.update(id, dto, tenantId);
  }

  @Delete(':id')
  @Permissions(PERMS.WAREHOUSE_MANAGE)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.warehouses.remove(id, tenantId);
  }
}
