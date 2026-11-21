// src/modules/manufacturing/boms.controller.ts
// قوائم المكوّنات والوصفات: للمصانع (تصنيع) وللمطاعم (وصفات الأطباق).
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
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BomsService } from './boms.service';
import {
  BomQueryDto,
  CreateBomDto,
  UpdateBomDto,
} from './dto/manufacturing.dto';

@ApiTags(apiTag('BOMS'))
@Controller('manufacturing/boms')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature([FEATURES.MANUFACTURING_MODULE, FEATURES.RESTAURANT_MODULE])
export class BomsController {
  constructor(private readonly boms: BomsService) {}

  /** القوائم والوصفات (بنوعها ومنتجها) */
  @Get()
  @Permissions(PERMS.BOM_VIEW)
  findAll(@Query() query: BomQueryDto, @CurrentTenantId() tenantId: string) {
    return this.boms.findAll(tenantId, query);
  }

  /** أين يُستعمل صنف كمكوّن */
  @Get('where-used/:productId')
  @Permissions(PERMS.BOM_VIEW)
  whereUsed(
    @Param('productId', ParseUUIDPipe) productId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.boms.whereUsed(productId, tenantId);
  }

  /** القائمة بمكوّناتها وخطواتها ومنتجاتها الثانوية */
  @Get(':id')
  @Permissions(PERMS.BOM_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.boms.findOne(id, tenantId);
  }

  /** التكلفة المقدّرة الآن: خامات بمتوسط تكلفتها + وقت − منتجات ثانوية، ونسبة تكلفة الطبق */
  @Get(':id/cost')
  @Permissions(PERMS.BOM_VIEW)
  cost(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.boms.cost(id, tenantId);
  }

  /** إنشاء قائمة أو وصفة (أول قائمة للصنف تصير افتراضية) */
  @Post()
  @Permissions(PERMS.BOM_MANAGE)
  create(@Body() dto: CreateBomDto, @CurrentTenantId() tenantId: string) {
    return this.boms.create(dto, tenantId);
  }

  /** نسخة جديدة (إصدار تالٍ غير افتراضي) للتعديل والتجربة */
  @Post(':id/duplicate')
  @Permissions(PERMS.BOM_MANAGE)
  duplicate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.boms.duplicate(id, tenantId);
  }

  /** تعديل قائمة (الأوامر المطلقة احتفظت بلقطتها ولا تتأثر) */
  @Patch(':id')
  @Permissions(PERMS.BOM_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBomDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.boms.update(id, dto, tenantId);
  }

  /** حذف قائمة لم يُنتج بها */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(PERMS.BOM_MANAGE)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.boms.remove(id, tenantId);
  }
}
