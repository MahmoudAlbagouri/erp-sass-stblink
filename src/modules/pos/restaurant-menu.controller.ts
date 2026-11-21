// src/modules/pos/restaurant-menu.controller.ts
// المطعم المتقدم: الإضافات والوجبات، محطات المطبخ، الحجوزات، الهالك، والتقارير.
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
  CreateKitchenStationDto,
  CreateModifierGroupDto,
  CreateReservationDto,
  DishWasteDto,
  ProductModifiersDto,
  ReservationQueryDto,
  ReservationStatusDto,
  RestaurantReportQueryDto,
  UpdateKitchenStationDto,
  UpdateModifierGroupDto,
  UpdateReservationDto,
} from './dto/restaurant-menu.dto';
import { ReservationsService } from './reservations.service';
import { RestaurantMenuService } from './restaurant-menu.service';
import { RestaurantReportsService } from './restaurant-reports.service';

@ApiTags(apiTag('RESTAURANT'))
@Controller('restaurant')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.RESTAURANT_MODULE)
export class RestaurantMenuController {
  constructor(
    private readonly menu: RestaurantMenuService,
    private readonly reservations: ReservationsService,
    private readonly reports: RestaurantReportsService,
  ) {}

  // ─── الإضافات والوجبات ───

  /** مجموعات الإضافات بخياراتها */
  @Get('modifier-groups')
  @Permissions(PERMS.PRODUCT_VIEW)
  findGroups(@CurrentTenantId() tenantId: string) {
    return this.menu.findGroups(tenantId);
  }

  /** مجموعة إضافات: اسمها، حد الاختيار، وخياراتها بسعرها وأثرها المخزني */
  @Post('modifier-groups')
  @Permissions(PERMS.RESTAURANT_MANAGE)
  createGroup(
    @Body() dto: CreateModifierGroupDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.menu.createGroup(dto, tenantId);
  }

  /** تعديل مجموعة (الخيار المحذوف يُوقف ولا يُمسح: المبيعات تشير إليه) */
  @Patch('modifier-groups/:id')
  @Permissions(PERMS.RESTAURANT_MANAGE)
  updateGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateModifierGroupDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.menu.updateGroup(id, dto, tenantId);
  }

  /** حذف مجموعة (وربطها بالأصناف) */
  @Delete('modifier-groups/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(PERMS.RESTAURANT_MANAGE)
  removeGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.menu.removeGroup(id, tenantId);
  }

  /** مجموعات الإضافات على صنف بترتيبها */
  @Get('products/:productId/modifier-groups')
  @Permissions(PERMS.PRODUCT_VIEW)
  productGroups(
    @Param('productId', ParseUUIDPipe) productId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.menu.productGroups(productId, tenantId);
  }

  /** تحديد مجموعات الإضافات على صنف (تستبدل القائمة بترتيبها) */
  @Post('products/:productId/modifier-groups')
  @Permissions(PERMS.RESTAURANT_MANAGE)
  setProductGroups(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: ProductModifiersDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.menu.setProductGroups(productId, dto.groupIds, tenantId);
  }

  // ─── محطات المطبخ ───

  /** محطات المطبخ بتصنيفاتها */
  @Get('stations')
  @Permissions(PERMS.KITCHEN_DISPLAY)
  findStations(@CurrentTenantId() tenantId: string) {
    return this.menu.findStations(tenantId);
  }

  /** محطة مطبخ: تستلم أسطر تصنيفاتها من كل بون */
  @Post('stations')
  @Permissions(PERMS.RESTAURANT_MANAGE)
  createStation(
    @Body() dto: CreateKitchenStationDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.menu.createStation(dto, tenantId);
  }

  /** تعديل محطة (تسري على البونات الجديدة) */
  @Patch('stations/:id')
  @Permissions(PERMS.RESTAURANT_MANAGE)
  updateStation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateKitchenStationDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.menu.updateStation(id, dto, tenantId);
  }

  /** حذف محطة */
  @Delete('stations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(PERMS.RESTAURANT_MANAGE)
  removeStation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.menu.removeStation(id, tenantId);
  }

  // ─── الهالك ───

  /** هالك طبق (تخرج مكوّنات وصفته) أو مكوّن، كتسوية سببها "هالك تشغيل" */
  @Post('waste')
  @Permissions(PERMS.STOCK_ADJUST)
  waste(
    @Body() dto: DishWasteDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.menu.recordWaste(dto, tenantId, userId);
  }

  // ─── الحجوزات ───

  /** حجوزات يوم (اليوم إن لم يُحدَّد) */
  @Get('reservations')
  @Permissions(PERMS.RESERVATION_MANAGE)
  findReservations(
    @Query() query: ReservationQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.reservations.findByDay(tenantId, query);
  }

  /** حجز جديد (الطاولة لا تُحجز مرتين في وقت متداخل) */
  @Post('reservations')
  @Permissions(PERMS.RESERVATION_MANAGE)
  createReservation(
    @Body() dto: CreateReservationDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.reservations.create(dto, tenantId, userId);
  }

  /** تعديل حجز قبل الجلوس */
  @Patch('reservations/:id')
  @Permissions(PERMS.RESERVATION_MANAGE)
  updateReservation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReservationDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.reservations.update(id, dto, tenantId);
  }

  /** حالة الحجز: جلس، أنهى، ألغى، لم يحضر (بوقتها الفعلي) */
  @Post('reservations/:id/status')
  @Permissions(PERMS.RESERVATION_MANAGE)
  setReservationStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReservationStatusDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.reservations.setStatus(id, dto.status, tenantId);
  }

  // ─── التقارير ───

  /** هندسة المنيو: شعبية كل صنف وهامشه بتكلفة وصفته الفعلية، وتصنيفه */
  @Get('reports/menu-engineering')
  @Permissions(PERMS.RESTAURANT_REPORTS_VIEW)
  menuEngineering(
    @Query() query: RestaurantReportQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.reports.menuEngineering(tenantId, query);
  }

  /** الاستهلاك النظري (الوصفات) مقابل الفعلي (هالك وتسويات وفروق جرد) لكل مكوّن */
  @Get('reports/consumption')
  @Permissions(PERMS.RESTAURANT_REPORTS_VIEW)
  consumption(
    @Query() query: RestaurantReportQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.reports.consumption(tenantId, query);
  }

  /** الخدمة: الضيوف، متوسط الفاتورة، مدة الطاولة، الطلب بالساعة، أزمنة المطبخ والمحطات، والحجوزات */
  @Get('reports/service')
  @Permissions(PERMS.RESTAURANT_REPORTS_VIEW)
  service(
    @Query() query: RestaurantReportQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.reports.service(tenantId, query);
  }
}
