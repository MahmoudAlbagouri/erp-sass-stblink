// src/modules/sales/customer-payments.controller.ts
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
import { CustomerPaymentsService } from './customer-payments.service';
import {
  CreateCustomerPaymentDto,
  CustomerPaymentQueryDto,
} from './dto/sales.dto';

@ApiTags(apiTag('CUSTOMER_PAYMENTS'))
@Controller('sales/payments')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.SALES_MODULE)
export class CustomerPaymentsController {
  constructor(private readonly payments: CustomerPaymentsService) {}

  /** قائمة سندات القبض والردّ */
  @Get()
  @Permissions(PERMS.SALES_VIEW)
  findAll(
    @Query() query: CustomerPaymentQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.payments.findAll(tenantId, query);
  }

  /** تسجيل قبض من عميل (على فاتورة أو على الحساب) */
  @Post()
  @Permissions(PERMS.CUSTOMER_PAYMENT_MANAGE)
  create(
    @Body() dto: CreateCustomerPaymentDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.payments.create(dto, tenantId, userId);
  }

  /** إلغاء سند قبض: يعود المبلغ على العميل */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.CUSTOMER_PAYMENT_MANAGE)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.payments.cancel(id, tenantId);
  }
}
