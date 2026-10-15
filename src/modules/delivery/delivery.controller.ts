// src/modules/delivery/delivery.controller.ts
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import type { CurrentUserData } from '../../common/types/auth.types';
import { apiTag } from '../../config/swagger.config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DeliveryService } from './delivery.service';
import {
  AssignDeliveryOrderDto,
  CreateDeliveryAgentDto,
  CreateDeliveryOrderDto,
  CreateDeliverySettlementDto,
  CreateDeliveryZoneDto,
  DeliveryAgentQueryDto,
  DeliveryOrderQueryDto,
  DeliverySettlementQueryDto,
  FailDeliveryOrderDto,
  UpdateDeliveryAgentDto,
  UpdateDeliveryZoneDto,
} from './dto/delivery.dto';

@ApiTags(apiTag('DELIVERY'))
@Controller('delivery')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.DELIVERY_MODULE)
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  // ─── اللوحة ─────────────────────────────────────────────────
  /** أعداد الحالات، المتأخر، ومال المحل مع الطيارين وشركات الشحن */
  @Get('summary')
  @Permissions(PERMS.DELIVERY_VIEW)
  summary(@CurrentTenantId() tenantId: string) {
    return this.delivery.summary(tenantId);
  }

  // ─── الأوردرات ──────────────────────────────────────────────
  /** الأوردرات: بالحالة (أو أكثر بفاصلة)، الجهة، غير المسوّاة، البحث، والتاريخ */
  @Get('orders')
  @Permissions(PERMS.DELIVERY_VIEW)
  findOrders(
    @Query() query: DeliveryOrderQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.delivery.findOrders(tenantId, query);
  }

  /** أوردر بفاتورته وأسطرها */
  @Get('orders/:id')
  @Permissions(PERMS.DELIVERY_VIEW)
  findOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.delivery.findOrder(id, tenantId);
  }

  /** أوردر جديد: فاتورة مسودة بأصنافه ورسوم التوصيل */
  @Post('orders')
  @Permissions(PERMS.DELIVERY_MANAGE)
  createOrder(
    @Body() dto: CreateDeliveryOrderDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.delivery.createOrder(dto, tenantId, user.id);
  }

  /** إسناد لطيار أو شركة شحن (أو تغييره قبل الخروج) */
  @Post('orders/:id/assign')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.DELIVERY_MANAGE)
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignDeliveryOrderDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.delivery.assign(id, dto, tenantId);
  }

  /** خرج مع الجهة: تصدر الفاتورة وتخرج البضاعة */
  @Post('orders/:id/dispatch')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.DELIVERY_MANAGE)
  dispatch(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.delivery.dispatch(id, tenantId, user.id);
  }

  /** تم التسليم للعميل */
  @Post('orders/:id/deliver')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.DELIVERY_MANAGE)
  deliver(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.delivery.deliver(id, tenantId);
  }

  /** لم يُسلَّم: مرتجع كامل وتعود البضاعة */
  @Post('orders/:id/fail')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.DELIVERY_MANAGE)
  fail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FailDeliveryOrderDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.delivery.fail(id, dto, tenantId, user.id);
  }

  /** إلغاء قبل الخروج */
  @Post('orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.DELIVERY_MANAGE)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.delivery.cancel(id, tenantId, user.id);
  }

  // ─── الطيارون وشركات الشحن ───────────────────────────────────
  /** الطيارون وشركات الشحن، ومع كل جهة ما معها الآن من أوردرات ومال */
  @Get('agents')
  @Permissions(PERMS.DELIVERY_VIEW)
  findAgents(
    @Query() query: DeliveryAgentQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.delivery.findAgents(tenantId, query);
  }

  /** جهة توصيل وما معها الآن */
  @Get('agents/:id')
  @Permissions(PERMS.DELIVERY_VIEW)
  findAgent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.delivery.findAgent(id, tenantId);
  }

  /** إضافة طيار أو شركة شحن */
  @Post('agents')
  @Permissions(PERMS.DELIVERY_AGENTS_MANAGE)
  createAgent(
    @Body() dto: CreateDeliveryAgentDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.delivery.createAgent(dto, tenantId);
  }

  /** تعديل جهة توصيل أو إيقافها */
  @Patch('agents/:id')
  @Permissions(PERMS.DELIVERY_AGENTS_MANAGE)
  updateAgent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliveryAgentDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.delivery.updateAgent(id, dto, tenantId);
  }

  /** حذف جهة لا شيء معلّق عليها (لا أوردرات مفتوحة ولا غير مسوّاة) */
  @Delete('agents/:id')
  @Permissions(PERMS.DELIVERY_AGENTS_MANAGE)
  removeAgent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.delivery.removeAgent(id, tenantId);
  }

  /**
   * رابط شاشة الطيار على جواله. المفتاح يظهر في الرد مرة واحدة؛ إصدار رابط
   * جديد يُبطل القديم.
   */
  @Post('agents/:id/driver-access')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.DELIVERY_AGENTS_MANAGE)
  issueDriverAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.delivery.issueDriverAccess(id, tenantId);
  }

  /** إيقاف رابط الطيار: شاشته تتوقف فوراً */
  @Delete('agents/:id/driver-access')
  @Permissions(PERMS.DELIVERY_AGENTS_MANAGE)
  revokeDriverAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.delivery.revokeDriverAccess(id, tenantId);
  }

  // ─── المناطق ────────────────────────────────────────────────
  /** مناطق التوصيل ورسومها ووقتها المتوقع */
  @Get('zones')
  @Permissions(PERMS.DELIVERY_VIEW)
  findZones(@CurrentTenantId() tenantId: string) {
    return this.delivery.findZones(tenantId);
  }

  /** إضافة منطقة توصيل */
  @Post('zones')
  @Permissions(PERMS.DELIVERY_AGENTS_MANAGE)
  createZone(
    @Body() dto: CreateDeliveryZoneDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.delivery.createZone(dto, tenantId);
  }

  /** تعديل منطقة أو إيقافها */
  @Patch('zones/:id')
  @Permissions(PERMS.DELIVERY_AGENTS_MANAGE)
  updateZone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeliveryZoneDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.delivery.updateZone(id, dto, tenantId);
  }

  /** حذف منطقة (الأوردرات القديمة تحتفظ باسمها) */
  @Delete('zones/:id')
  @Permissions(PERMS.DELIVERY_AGENTS_MANAGE)
  removeZone(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.delivery.removeZone(id, tenantId);
  }

  // ─── التسويات ───────────────────────────────────────────────
  /** تسويات الطيارين وشركات الشحن */
  @Get('settlements')
  @Permissions(PERMS.DELIVERY_VIEW)
  findSettlements(
    @Query() query: DeliverySettlementQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.delivery.findSettlements(tenantId, query);
  }

  /** تسوية بأوردراتها */
  @Get('settlements/:id')
  @Permissions(PERMS.DELIVERY_VIEW)
  findSettlement(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.delivery.findSettlement(id, tenantId);
  }

  /** تسوية طيار أو شركة شحن: استلام ما حصّلته بعد رسومها */
  @Post('settlements')
  @Permissions(PERMS.DELIVERY_SETTLE)
  settle(
    @Body() dto: CreateDeliverySettlementDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.delivery.settle(dto, tenantId, user.id);
  }
}
