// src/modules/sales/sales-invoices.controller.ts
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
import { CheckQuota } from '../../common/decorators/check-quota.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { CurrentUserData } from '../../common/types/auth.types';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateSalesInvoiceDto,
  IssueSalesInvoiceDto,
  SalesInvoiceQueryDto,
  UpdateSalesInvoiceDto,
} from './dto/sales.dto';
import { SalesInvoice } from './entities/sales-invoice.entity';
import { SalesInvoicesService } from './sales-invoices.service';

/** تكلفة البضاعة والربح لا يراهما إلا من له صلاحية الأرباح */
function canSeeProfit(user: CurrentUserData): boolean {
  return (
    user.isSuperAdmin ||
    (user.permissions ?? []).includes(PERMS.SALES_PROFIT_VIEW.name)
  );
}

function withoutCost(invoice: SalesInvoice): SalesInvoice {
  invoice.costTotal = 0;
  invoice.lines?.forEach((line) => {
    line.unitCost = 0;
  });
  return invoice;
}

@ApiTags(apiTag('SALES_INVOICES'))
@Controller('sales')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.SALES_MODULE)
export class SalesInvoicesController {
  constructor(private readonly invoices: SalesInvoicesService) {}

  /** أرقام لوحة المبيعات: مبيعات اليوم والشهر، المديونيات، المتأخر */
  @Get('summary')
  @Permissions(PERMS.SALES_VIEW)
  async summary(
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    const summary = await this.invoices.summary(tenantId);
    return canSeeProfit(user) ? summary : { ...summary, monthProfit: null };
  }

  /** قائمة فواتير البيع */
  @Get('invoices')
  @Permissions(PERMS.SALES_VIEW)
  async findAll(
    @Query() query: SalesInvoiceQueryDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    const result = await this.invoices.findAll(tenantId, query);
    if (!canSeeProfit(user)) result.data.forEach(withoutCost);
    return result;
  }

  /** فاتورة بيع واحدة ببنودها وفرعها */
  @Get('invoices/:id')
  @Permissions(PERMS.SALES_VIEW)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    const invoice = await this.invoices.findOne(id, tenantId);
    return canSeeProfit(user) ? invoice : withoutCost(invoice);
  }

  /** إنشاء فاتورة بيع (مسودة) */
  @Post('invoices')
  @Permissions(PERMS.SALES_MANAGE)
  async create(
    @Body() dto: CreateSalesInvoiceDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    const invoice = await this.invoices.create(dto, tenantId, user.id);
    return canSeeProfit(user) ? invoice : withoutCost(invoice);
  }

  /** تعديل مسودة فاتورة بيع */
  @Patch('invoices/:id')
  @Permissions(PERMS.SALES_MANAGE)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalesInvoiceDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    const invoice = await this.invoices.update(id, dto, tenantId);
    return canSeeProfit(user) ? invoice : withoutCost(invoice);
  }

  /** إصدار الفاتورة: تأخذ رقمها، تخرج البضاعة، ويُسجَّل ما قُبض */
  @Post('invoices/:id/issue')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.SALES_ISSUE)
  @CheckQuota('max_invoices')
  async issue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IssueSalesInvoiceDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    const invoice = await this.invoices.issue(id, dto, tenantId, user.id);
    return canSeeProfit(user) ? invoice : withoutCost(invoice);
  }

  /** إلغاء مسودة فاتورة بيع */
  @Post('invoices/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.SALES_MANAGE)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.invoices.cancel(id, tenantId);
  }
}
