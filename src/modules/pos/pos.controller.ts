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
  CreatePosDeviceDto,
  PosBootstrapQueryDto,
  PosShiftQueryDto,
  PosSyncDto,
  UpdatePosDeviceDto,
} from './dto/pos.dto';
import { PosService } from './pos.service';

@Controller('pos')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.POS_MODULE)
export class PosController {
  constructor(private readonly pos: PosService) {}

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
      canReturn:
        user.isSuperAdmin ||
        (user.permissions ?? []).includes(PERMS.POS_RETURN.name),
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

  /** ربط هذا المتصفح بجهاز كاشير (مرة واحدة لكل شاشة بيع) */
  @Post('devices/:id/bind')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.POS_USE)
  bindDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BindDeviceDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.pos.bindDevice(id, dto.installationId, tenantId);
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
  @Get('devices')
  @Permissions(PERMS.POS_VIEW)
  findDevices(@CurrentTenantId() tenantId: string) {
    return this.pos.findDevices(tenantId);
  }

  @Post('devices')
  @Permissions(PERMS.POS_DEVICE_MANAGE)
  @CheckQuota('max_pos_devices')
  createDevice(
    @Body() dto: CreatePosDeviceDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.pos.createDevice(dto, tenantId);
  }

  @Patch('devices/:id')
  @Permissions(PERMS.POS_DEVICE_MANAGE)
  updateDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePosDeviceDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.pos.updateDevice(id, dto, tenantId);
  }

  @Delete('devices/:id')
  @Permissions(PERMS.POS_DEVICE_MANAGE)
  removeDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.pos.removeDevice(id, tenantId);
  }

  @Get('shifts')
  @Permissions(PERMS.POS_VIEW)
  findShifts(
    @Query() query: PosShiftQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.pos.findShifts(tenantId, query);
  }
}
