// src/modules/sales/customers.controller.ts
// العملاء وكشوف حساباتهم + إعدادات الفوترة (بيانات البائع على الفاتورة).
import {
  Body,
  Controller,
  Delete,
  Get,
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
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CustomersService } from './customers.service';
import {
  CreateCustomerDto,
  CustomerQueryDto,
  StatementQueryDto,
  UpdateCustomerDto,
  UpdateSalesSettingsDto,
} from './dto/sales.dto';
import { SalesSettingsService } from './sales-settings.service';

@ApiTags(apiTag('CUSTOMERS'))
@Controller('sales')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.SALES_MODULE)
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly settings: SalesSettingsService,
  ) {}

  // ─── إعدادات الفوترة ────────────────────────────────────────
  // القراءة لكل من يرى الفواتير (تُطبع عليها)، والتعديل بصلاحية خاصة
  /** إعدادات الفوترة: بيانات البائع والضريبة وتذييل الفاتورة */
  @Get('settings')
  @Permissions(PERMS.SALES_VIEW)
  getSettings(@CurrentTenantId() tenantId: string) {
    return this.settings.get(tenantId);
  }

  /** تعديل إعدادات الفوترة */
  @Patch('settings')
  @Permissions(PERMS.SALES_SETTINGS_MANAGE)
  updateSettings(
    @Body() dto: UpdateSalesSettingsDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settings.update(tenantId, dto);
  }

  // ─── العملاء ────────────────────────────────────────────────
  /** قائمة العملاء وأرصدتهم */
  @Get('customers')
  @Permissions(PERMS.CUSTOMER_VIEW)
  findAll(
    @Query() query: CustomerQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.customers.findAll(tenantId, query);
  }

  /** عميل واحد */
  @Get('customers/:id')
  @Permissions(PERMS.CUSTOMER_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.customers.findOne(id, tenantId);
  }

  /** كشف حساب عميل */
  @Get('customers/:id/statement')
  @Permissions(PERMS.CUSTOMER_VIEW)
  statement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: StatementQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.customers.statement(id, tenantId, query);
  }

  /** إضافة عميل */
  @Post('customers')
  @Permissions(PERMS.CUSTOMER_MANAGE)
  create(@Body() dto: CreateCustomerDto, @CurrentTenantId() tenantId: string) {
    return this.customers.create(dto, tenantId);
  }

  /** تعديل عميل */
  @Patch('customers/:id')
  @Permissions(PERMS.CUSTOMER_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.customers.update(id, dto, tenantId);
  }

  /** حذف عميل */
  @Delete('customers/:id')
  @Permissions(PERMS.CUSTOMER_MANAGE)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.customers.remove(id, tenantId);
  }
}
