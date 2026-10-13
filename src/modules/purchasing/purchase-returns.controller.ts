// src/modules/purchasing/purchase-returns.controller.ts
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
  CreatePurchaseReturnDto,
  PurchaseReturnQueryDto,
} from './dto/purchasing.dto';
import { PurchaseReturnsService } from './purchase-returns.service';

@ApiTags(apiTag('PURCHASE_RETURNS'))
@Controller('purchasing/returns')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.PURCHASING_MODULE)
export class PurchaseReturnsController {
  constructor(private readonly returns: PurchaseReturnsService) {}

  /** قائمة مرتجعات الشراء */
  @Get()
  @Permissions(PERMS.PURCHASE_VIEW)
  findAll(
    @Query() query: PurchaseReturnQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.returns.findAll(tenantId, query);
  }

  /** مرتجع شراء واحد ببنوده */
  @Get(':id')
  @Permissions(PERMS.PURCHASE_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.returns.findOne(id, tenantId);
  }

  /** إنشاء مرتجع شراء على فاتورة (مسودة) */
  @Post()
  @Permissions(PERMS.PURCHASE_RETURN_MANAGE)
  create(
    @Body() dto: CreatePurchaseReturnDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.returns.create(dto, tenantId, userId);
  }

  /** اعتماد مرتجع الشراء: تخرج البضاعة ويُخصم من مستحق المورد */
  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.PURCHASE_RETURN_MANAGE)
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.returns.post(id, tenantId, userId);
  }

  /** إلغاء مسودة مرتجع شراء */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.PURCHASE_RETURN_MANAGE)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.returns.cancel(id, tenantId);
  }
}
