// src/modules/sales/sales-returns.controller.ts
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
  CreateSalesReturnDto,
  IssueSalesReturnDto,
  SalesReturnQueryDto,
} from './dto/sales.dto';
import { SalesReturnsService } from './sales-returns.service';

@ApiTags(apiTag('SALES_RETURNS'))
@Controller('sales/returns')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.SALES_MODULE)
export class SalesReturnsController {
  constructor(private readonly returns: SalesReturnsService) {}

  /** قائمة مرتجعات البيع */
  @Get()
  @Permissions(PERMS.SALES_VIEW)
  findAll(
    @Query() query: SalesReturnQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.returns.findAll(tenantId, query);
  }

  /** مرتجع بيع واحد ببنوده */
  @Get(':id')
  @Permissions(PERMS.SALES_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.returns.findOne(id, tenantId);
  }

  /** إنشاء مرتجع بيع على فاتورة (مسودة) */
  @Post()
  @Permissions(PERMS.SALES_RETURN_MANAGE)
  create(
    @Body() dto: CreateSalesReturnDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.returns.create(dto, tenantId, userId);
  }

  /** إصدار المرتجع: تعود البضاعة للمخزن ويُردّ المبلغ أو يُخصم من دين العميل */
  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.SALES_RETURN_MANAGE)
  issue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IssueSalesReturnDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.returns.issue(id, dto, tenantId, userId);
  }

  /** إلغاء مسودة مرتجع بيع */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.SALES_RETURN_MANAGE)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.returns.cancel(id, tenantId);
  }
}
