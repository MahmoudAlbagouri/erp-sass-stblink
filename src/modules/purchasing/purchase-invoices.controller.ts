// src/modules/purchasing/purchase-invoices.controller.ts
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
  CreatePurchaseInvoiceDto,
  PurchaseInvoiceQueryDto,
  UpdatePurchaseInvoiceDto,
} from './dto/purchasing.dto';
import { PurchaseInvoicesService } from './purchase-invoices.service';

@ApiTags(apiTag('PURCHASE_INVOICES'))
@Controller('purchasing/invoices')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.PURCHASING_MODULE)
export class PurchaseInvoicesController {
  constructor(private readonly invoices: PurchaseInvoicesService) {}

  /** قائمة فواتير الشراء */
  @Get()
  @Permissions(PERMS.PURCHASE_VIEW)
  findAll(
    @Query() query: PurchaseInvoiceQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.invoices.findAll(tenantId, query);
  }

  /** فاتورة شراء واحدة ببنودها */
  @Get(':id')
  @Permissions(PERMS.PURCHASE_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.invoices.findOne(id, tenantId);
  }

  /** إنشاء فاتورة شراء (مسودة) */
  @Post()
  @Permissions(PERMS.PURCHASE_MANAGE)
  create(
    @Body() dto: CreatePurchaseInvoiceDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.invoices.create(dto, tenantId, userId);
  }

  /** تعديل مسودة فاتورة شراء */
  @Patch(':id')
  @Permissions(PERMS.PURCHASE_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseInvoiceDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.invoices.update(id, dto, tenantId);
  }

  /** اعتماد فاتورة الشراء: تدخل البضاعة المخزن ويُحدَّث متوسط التكلفة */
  @Post(':id/post')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.PURCHASE_POST)
  post(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.invoices.post(id, tenantId, userId);
  }

  /** إلغاء فاتورة شراء (المعتمدة تخرج بضاعتها من المخزن) */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.PURCHASE_POST)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.invoices.cancel(id, tenantId, userId);
  }
}
