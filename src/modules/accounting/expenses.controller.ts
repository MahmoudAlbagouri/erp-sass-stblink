// src/modules/accounting/expenses.controller.ts
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
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURES } from '../../common/constants/features';
import { PERMS } from '../../common/constants/permissions';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { apiTag } from '../../config/swagger.config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CompanyWideInterceptor } from './company-wide.interceptor';
import {
  CancelExpenseVoucherDto,
  CreateExpenseVoucherDto,
  ExpenseQueryDto,
} from './dto/accounting.dto';
import { ExpensesService } from './expenses.service';

@ApiTags(apiTag('ACCOUNTING'))
@Controller('accounting/expenses')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@UseInterceptors(CompanyWideInterceptor)
@RequiresFeature(FEATURES.ACCOUNTING_MODULE)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  /** سندات الصرف بفلاتر التاريخ والحالة والحساب والبحث */
  @Get()
  @Permissions(PERMS.ACCOUNTING_VIEW)
  findAll(
    @Query() query: ExpenseQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.expenses.findAll(tenantId, query);
  }

  /** سند صرف واحد ببنوده (الحساب، الضريبة، الفرع) */
  @Get(':id')
  @Permissions(PERMS.ACCOUNTING_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.expenses.findOne(id, tenantId);
  }

  /** سند صرف: يُقيَّد فوراً من حساب المصروف (والضريبة المستردة) إلى الصندوق أو البنك */
  @Post()
  @Permissions(PERMS.EXPENSE_VOUCHER_MANAGE)
  create(
    @Body() dto: CreateExpenseVoucherDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.expenses.create(tenantId, dto, userId);
  }

  /** إلغاء سند صرف بقيد عكسي بتاريخ الإلغاء (السند يبقى للمراجعة) */
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.EXPENSE_VOUCHER_MANAGE)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelExpenseVoucherDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.expenses.cancel(tenantId, id, dto, userId);
  }
}
