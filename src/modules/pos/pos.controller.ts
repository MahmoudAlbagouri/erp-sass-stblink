// src/modules/pos/pos.controller.ts
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
import type { CurrentUserData } from '../../common/types/auth.types';
import { PERMS } from '../../common/constants/permissions';
import { CheckQuota } from '../../common/decorators/check-quota.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  BindDeviceDto,
  CreatePromotionDto,
  PosAuditQueryDto,
  PosCashMovementQueryDto,
  UpdatePromotionDto,
  CreatePosCashierDto,
  CreatePosDeviceDto,
  PosBootstrapQueryDto,
  PosShiftQueryDto,
  PosSyncDto,
  UpdatePosCashierDto,
  UpdatePosDeviceDto,
} from './dto/pos.dto';
import { UpdatePosScreenSettingsDto } from './dto/pos-screen.dto';
import { PosCashiersService } from './pos-cashiers.service';
import { PosScreenSettingsService } from './pos-screen-settings.service';
import { PosExtrasService } from './pos-extras.service';
import { PosService } from './pos.service';

@ApiTags(apiTag('POS'))
@Controller('pos')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.POS_MODULE)
export class PosController {
  constructor(
    private readonly pos: PosService,
    private readonly cashiers: PosCashiersService,
    private readonly extras: PosExtrasService,
    private readonly screenSettings: PosScreenSettingsService,
  ) {}

  // ─── مميزات شاشة الكاشير ─────────────────────────────────────
  /** مميزات الشاشة الظاهرة لهذه الشركة، والقوالب الجاهزة، وما تسمح به الباقة */
  @Get('screen-settings')
  @Permissions(PERMS.POS_VIEW)
  screenSettingsOf(@CurrentTenantId() tenantId: string) {
    return this.screenSettings.get(tenantId);
  }

  /** تشغيل وإقفال مميزات الشاشة أو تطبيق قالب (تصل الأجهزة مع مزامنتها) */
  @Patch('screen-settings')
  @Permissions(PERMS.POS_SETTINGS_MANAGE)
  updateScreenSettings(
    @Body() dto: UpdatePosScreenSettingsDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.screenSettings.update(tenantId, dto);
  }

  // ─── شاشة الكاشير ───────────────────────────────────────────
  /** فحص الاتصال: الجهاز يسأل دورياً ليعرف هل يرفع ما في طابوره */
  @Get('ping')
  @Permissions(PERMS.POS_USE)
  ping() {
    return { serverTime: new Date().toISOString() };
  }

  /** تنزيل بيانات البيع للجهاز (كلها أو ما تغيّر منذ آخر مزامنة) */
  @Get('bootstrap')
  @Permissions(PERMS.POS_USE)
  bootstrap(
    @Query() query: PosBootstrapQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.pos.bootstrap(
      query.deviceId,
      query.installationId,
      tenantId,
      query.since,
    );
  }

  /** رفع طابور الجهاز: ورديات ومبيعات تمّت محلياً */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.POS_USE)
  sync(
    @Body() dto: PosSyncDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.pos.sync(dto, tenantId, {
      id: user.id,
      canReturn: canReturn(user),
    });
  }

  /** فاتورة برقمها المطبوع: لاختيار ما يُرجَع منها على شاشة الكاشير */
  @Get('invoices/:number')
  @Permissions(PERMS.POS_USE, PERMS.POS_RETURN)
  lookupInvoice(
    @Param('number') number: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.pos.lookupInvoice(number, tenantId);
  }

  /**
   * ربط هذا المتصفح بجهاز كاشير (مرة واحدة لكل شاشة بيع). الرد يحمل مفتاح
   * الجهاز: به تعمل الشاشة بعد ذلك دون جلسة مستخدم (انظر PosDeviceController).
   */
  @Post('devices/:id/bind')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.POS_USE)
  bindDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BindDeviceDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.pos.bindDevice(
      id,
      dto.installationId,
      tenantId,
      canReturn(user),
    );
  }

  /** فكّ ربط الجهاز ليُربط بشاشة أخرى (قرار المدير) */
  @Post('devices/:id/unbind')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.POS_DEVICE_MANAGE)
  unbindDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.pos.unbindDevice(id, tenantId);
  }

  // ─── الأجهزة والورديات (لوحة التحكم) ─────────────────────────
  /** قائمة أجهزة الكاشير (مع مخزنها وفرعها ووردياتها المفتوحة) */
  @Get('devices')
  @Permissions(PERMS.POS_VIEW)
  findDevices(@CurrentTenantId() tenantId: string) {
    return this.pos.findDevices(tenantId);
  }

  /** إضافة جهاز كاشير */
  @Post('devices')
  @Permissions(PERMS.POS_DEVICE_MANAGE)
  @CheckQuota('max_pos_devices')
  createDevice(
    @Body() dto: CreatePosDeviceDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.pos.createDevice(dto, tenantId);
  }

  /** تعديل جهاز كاشير أو إيقافه */
  @Patch('devices/:id')
  @Permissions(PERMS.POS_DEVICE_MANAGE)
  updateDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePosDeviceDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.pos.updateDevice(id, dto, tenantId);
  }

  /** حذف جهاز كاشير */
  @Delete('devices/:id')
  @Permissions(PERMS.POS_DEVICE_MANAGE)
  removeDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.pos.removeDevice(id, tenantId);
  }

  // ─── الكاشيرات وأرقامهم السرية (لوحة التحكم) ─────────────────
  /** قائمة الكاشيرات */
  @Get('cashiers')
  @Permissions(PERMS.POS_VIEW)
  findCashiers(@CurrentTenantId() tenantId: string) {
    return this.cashiers.findAll(tenantId);
  }

  /** إضافة كاشير برقمه السري */
  @Post('cashiers')
  @Permissions(PERMS.POS_DEVICE_MANAGE)
  createCashier(
    @Body() dto: CreatePosCashierDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.cashiers.create(dto, tenantId);
  }

  /** تعديل كاشير أو رقمه السري أو إيقافه */
  @Patch('cashiers/:id')
  @Permissions(PERMS.POS_DEVICE_MANAGE)
  updateCashier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePosCashierDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.cashiers.update(id, dto, tenantId);
  }

  /** حذف كاشير */
  @Delete('cashiers/:id')
  @Permissions(PERMS.POS_DEVICE_MANAGE)
  removeCashier(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.cashiers.remove(id, tenantId);
  }

  /** ورديات الكاشير وأرقامها */
  @Get('shifts')
  @Permissions(PERMS.POS_VIEW)
  findShifts(
    @Query() query: PosShiftQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.pos.findShifts(tenantId, query);
  }

  // ─── حركات الدرج وسجل التدقيق (لوحة التحكم) ─────────────────
  /** إيداعات وسحوبات الدرج النقدية خلال الورديات */
  @Get('cash-movements')
  @Permissions(PERMS.POS_AUDIT_VIEW)
  findCashMovements(
    @Query() query: PosCashMovementQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.extras.findCashMovements(tenantId, query);
  }

  /** سجل تدقيق الكاشير: حذف سطور، إفراغ سلة، فتح درج، خصومات، موافقات */
  @Get('audit')
  @Permissions(PERMS.POS_AUDIT_VIEW)
  findAudit(
    @Query() query: PosAuditQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.extras.findAudit(tenantId, query);
  }

  // ─── العروض والأسعار الخاصة ─────────────────
  /** قائمة عروض الكاشير وأسعاره الخاصة */
  @Get('promotions')
  @Permissions(PERMS.POS_VIEW)
  findPromotions(@CurrentTenantId() tenantId: string) {
    return this.extras.findPromotions(tenantId);
  }

  /** إضافة عرض: سعر خاص، خصم نسبة، أو اشترِ X واحصل على Y */
  @Post('promotions')
  @Permissions(PERMS.POS_PROMOTION_MANAGE)
  createPromotion(
    @Body() dto: CreatePromotionDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.extras.createPromotion(dto, tenantId);
  }

  /** تعديل عرض أو إيقافه */
  @Patch('promotions/:id')
  @Permissions(PERMS.POS_PROMOTION_MANAGE)
  updatePromotion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromotionDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.extras.updatePromotion(id, dto, tenantId);
  }

  /** حذف عرض */
  @Delete('promotions/:id')
  @Permissions(PERMS.POS_PROMOTION_MANAGE)
  removePromotion(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.extras.removePromotion(id, tenantId);
  }
}

/** مدير الشركة، أو موظف بصلاحية المرتجع من شاشة الكاشير */
function canReturn(user: CurrentUserData): boolean {
  return (
    user.isSuperAdmin ||
    (user.permissions ?? []).includes(PERMS.POS_RETURN.name)
  );
}
