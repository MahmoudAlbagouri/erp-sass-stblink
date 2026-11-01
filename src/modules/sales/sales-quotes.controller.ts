// src/modules/sales/sales-quotes.controller.ts
import {
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
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SalesQuoteQueryDto } from './dto/sales.dto';
import { SalesQuotesService } from './sales-quotes.service';

/** متابعة عروض الأسعار: تُنشأ من شاشة الكاشير وتتحول لفاتورة عليها */
@ApiTags(apiTag('SALES_QUOTES'))
@Controller('sales/quotes')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.SALES_MODULE)
export class SalesQuotesController {
  constructor(private readonly quotes: SalesQuotesService) {}

  /** قائمة عروض أسعار العملاء */
  @Get()
  @Permissions(PERMS.SALES_VIEW)
  findAll(
    @Query() query: SalesQuoteQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.quotes.findAll(tenantId, query);
  }

  /** عرض سعر واحد ببنوده */
  @Get(':id')
  @Permissions(PERMS.SALES_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.quotes.findOne(id, tenantId);
  }

  /** إلغاء عرض سعر قائم: لا يتحول لفاتورة بعدها */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.SALES_MANAGE)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.quotes.cancel(id, tenantId);
  }
}
