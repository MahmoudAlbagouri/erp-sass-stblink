// src/modules/pos/restaurant.controller.ts
import {
  Body,
  Controller,
  Delete,
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
import { FEATURES } from '../../common/constants/features';
import { PERMS } from '../../common/constants/permissions';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { apiTag } from '../../config/swagger.config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  BulkCreateTablesDto,
  CreateDiningTableDto,
  KitchenBoardQueryDto,
  KitchenStatusDto,
  UpdateDiningTableDto,
  UpdateRestaurantSettingsDto,
} from './dto/restaurant.dto';
import { RestaurantService } from './restaurant.service';

/**
 * المطاعم: الطاولات وإعدادات المطبخ (لوحة التحكم)، وشاشة المطبخ. طلبات
 * المطبخ نفسها ترفعها شاشات الكاشير في طابورها (PosDeviceController).
 */
@ApiTags(apiTag('POS'))
@Controller('pos')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.RESTAURANT_MODULE)
export class RestaurantController {
  constructor(private readonly restaurant: RestaurantService) {}

  // ─── الطاولات ───

  /** طاولات المطعم مرتبة بالقسم (المقيَّد بفروع: طاولات فروعه والمشتركة) */
  @Get('restaurant/tables')
  @Permissions(PERMS.POS_VIEW)
  tables(@CurrentTenantId() tenantId: string) {
    return this.restaurant.findTables(tenantId);
  }

  /** إضافة طاولة */
  @Post('restaurant/tables')
  @Permissions(PERMS.RESTAURANT_MANAGE)
  createTable(
    @Body() dto: CreateDiningTableDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.restaurant.createTable(dto, tenantId);
  }

  /** إضافة طاولات متتالية دفعة واحدة ("طاولة 1" … "طاولة 20") */
  @Post('restaurant/tables/bulk')
  @Permissions(PERMS.RESTAURANT_MANAGE)
  createTables(
    @Body() dto: BulkCreateTablesDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.restaurant.createTables(dto, tenantId);
  }

  /** تعديل طاولة أو إيقافها */
  @Patch('restaurant/tables/:id')
  @Permissions(PERMS.RESTAURANT_MANAGE)
  updateTable(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDiningTableDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.restaurant.updateTable(id, dto, tenantId);
  }

  /** حذف طاولة (بونات المطبخ القديمة تبقى باسمها) */
  @Delete('restaurant/tables/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(PERMS.RESTAURANT_MANAGE)
  removeTable(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.restaurant.removeTable(id, tenantId);
  }

  // ─── إعدادات المطبخ ───

  /** إعدادات المطبخ: التصنيفات التي تُحضَّر فيه، طباعة البون، والإرسال عند الدفع */
  @Get('restaurant/settings')
  @Permissions(PERMS.POS_VIEW)
  settings(@CurrentTenantId() tenantId: string) {
    return this.restaurant.getSettings(tenantId);
  }

  /** تعديل إعدادات المطبخ (تصل شاشات الكاشير مع مزامنتها التالية) */
  @Patch('restaurant/settings')
  @Permissions(PERMS.RESTAURANT_MANAGE)
  updateSettings(
    @Body() dto: UpdateRestaurantSettingsDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.restaurant.updateSettings(tenantId, dto);
  }

  // ─── شاشة المطبخ ───

  /** طلبات المطبخ: الجديد وقيد التحضير والجاهز الذي لم يُسلَّم */
  @Get('kitchen/orders')
  @Permissions(PERMS.KITCHEN_DISPLAY)
  board(
    @Query() query: KitchenBoardQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.restaurant.board(tenantId, query.branchId);
  }

  /** نقل طلب: قيد التحضير، جاهز، سُلّم (أو الرجوع خطوة) */
  @Patch('kitchen/orders/:id')
  @Permissions(PERMS.KITCHEN_DISPLAY)
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: KitchenStatusDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.restaurant.updateStatus(id, dto.status, tenantId);
  }
}
