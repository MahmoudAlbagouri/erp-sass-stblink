// src/modules/purchasing/suppliers.controller.ts
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
import {
  CreateSupplierDto,
  StatementQueryDto,
  SupplierQueryDto,
  UpdateSupplierDto,
} from './dto/purchasing.dto';
import { SuppliersService } from './suppliers.service';

@ApiTags(apiTag('SUPPLIERS'))
@Controller('purchasing')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.PURCHASING_MODULE)
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  /** أرقام لوحة المشتريات: المستحق، المتأخر، مشتريات الشهر */
  @Get('summary')
  @Permissions(PERMS.PURCHASE_VIEW)
  summary(@CurrentTenantId() tenantId: string) {
    return this.suppliers.summary(tenantId);
  }

  /** قائمة الموردين وأرصدتهم */
  @Get('suppliers')
  @Permissions(PERMS.SUPPLIER_VIEW)
  findAll(
    @Query() query: SupplierQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.suppliers.findAll(tenantId, query);
  }

  /** مورد واحد */
  @Get('suppliers/:id')
  @Permissions(PERMS.SUPPLIER_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.suppliers.findOne(id, tenantId);
  }

  /** كشف حساب مورد */
  @Get('suppliers/:id/statement')
  @Permissions(PERMS.SUPPLIER_VIEW)
  statement(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: StatementQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.suppliers.statement(id, tenantId, query);
  }

  /** إضافة مورد */
  @Post('suppliers')
  @Permissions(PERMS.SUPPLIER_MANAGE)
  create(@Body() dto: CreateSupplierDto, @CurrentTenantId() tenantId: string) {
    return this.suppliers.create(dto, tenantId);
  }

  /** تعديل مورد */
  @Patch('suppliers/:id')
  @Permissions(PERMS.SUPPLIER_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.suppliers.update(id, dto, tenantId);
  }

  /** حذف مورد */
  @Delete('suppliers/:id')
  @Permissions(PERMS.SUPPLIER_MANAGE)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.suppliers.remove(id, tenantId);
  }
}
