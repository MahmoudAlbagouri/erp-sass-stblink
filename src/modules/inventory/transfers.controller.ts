// src/modules/inventory/transfers.controller.ts
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
  CreateTransferDto,
  ReceiveTransferDto,
  TransferQueryDto,
  UpdateTransferDto,
} from './dto/inventory.dto';
import { TransfersService } from './transfers.service';

@Controller('inventory/transfers')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.INVENTORY_MODULE)
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get()
  @Permissions(PERMS.INVENTORY_VIEW)
  findAll(
    @Query() query: TransferQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.transfers.findAll(tenantId, query);
  }

  @Get(':id')
  @Permissions(PERMS.INVENTORY_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.transfers.findOne(id, tenantId);
  }

  @Post()
  @Permissions(PERMS.STOCK_TRANSFER_MANAGE)
  create(
    @Body() dto: CreateTransferDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.transfers.create(dto, tenantId, userId);
  }

  @Patch(':id')
  @Permissions(PERMS.STOCK_TRANSFER_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTransferDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.transfers.update(id, dto, tenantId);
  }

  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.STOCK_TRANSFER_MANAGE)
  send(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.transfers.send(id, tenantId, userId);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.STOCK_TRANSFER_RECEIVE)
  receive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveTransferDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.transfers.receive(id, dto, tenantId, userId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.STOCK_TRANSFER_MANAGE)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.transfers.cancel(id, tenantId, userId);
  }
}
