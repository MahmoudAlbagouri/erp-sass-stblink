// src/modules/purchasing/supplier-payments.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
  CreateSupplierPaymentDto,
  SupplierPaymentQueryDto,
} from './dto/purchasing.dto';
import { SupplierPaymentsService } from './supplier-payments.service';

@Controller('purchasing/payments')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.PURCHASING_MODULE)
export class SupplierPaymentsController {
  constructor(private readonly payments: SupplierPaymentsService) {}

  @Get()
  @Permissions(PERMS.PURCHASE_VIEW)
  findAll(
    @Query() query: SupplierPaymentQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.payments.findAll(tenantId, query);
  }

  @Post()
  @Permissions(PERMS.SUPPLIER_PAYMENT_MANAGE)
  create(
    @Body() dto: CreateSupplierPaymentDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.payments.create(dto, tenantId, userId);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.SUPPLIER_PAYMENT_MANAGE)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.payments.cancel(id, tenantId);
  }
}
