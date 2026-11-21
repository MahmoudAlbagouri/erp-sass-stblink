// src/modules/manufacturing/production-orders.controller.ts
// أوامر الإنتاج من التخطيط للإكمال.
import {
  Body,
  Controller,
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CancelProductionOrderDto,
  CreateProductionOrderDto,
  IssueMaterialsDto,
  ManualTimeLogDto,
  ProductionOrderQueryDto,
  ProductionOutputDto,
  ReturnMaterialsDto,
  StartTimeLogDto,
  StopTimeLogDto,
  UpdateProductionOrderDto,
} from './dto/manufacturing.dto';
import { ProductionOrdersService } from './production-orders.service';

@ApiTags(apiTag('PRODUCTION'))
@Controller('manufacturing/orders')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.MANUFACTURING_MODULE)
export class ProductionOrdersController {
  constructor(private readonly orders: ProductionOrdersService) {}

  /** أوامر الإنتاج (status=open للمفتوحة) بنسبة إنجازها وتأخرها */
  @Get()
  @Permissions(PERMS.MANUFACTURING_VIEW)
  findAll(
    @Query() query: ProductionOrderQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.orders.findAll(tenantId, query);
  }

  /** لوحة المصنع: الأوامر بحالاتها، المتأخرة، إنتاج الشهر ونسبة هالكه */
  @Get('summary')
  @Permissions(PERMS.MANUFACTURING_VIEW)
  summary(@CurrentTenantId() tenantId: string) {
    return this.orders.summary(tenantId);
  }

  /** الأمر بخاماته وخطواته وسجل وقته وحركاته وتكلفته حتى الآن */
  @Get(':id')
  @Permissions(PERMS.MANUFACTURING_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.orders.findOne(id, tenantId);
  }

  /** أمر جديد (مسودة) بخاماته وخطواته من القائمة */
  @Post()
  @Permissions(PERMS.PRODUCTION_PLAN)
  create(
    @Body() dto: CreateProductionOrderDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.orders.create(dto, tenantId, userId);
  }

  /** تعديل مسودة (يعيد حساب خاماتها وخطواتها) */
  @Patch(':id')
  @Permissions(PERMS.PRODUCTION_PLAN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductionOrderDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.orders.update(id, dto, tenantId);
  }

  /** إطلاق للتنفيذ: لقطة من القائمة وأسعار المراكز، والتكلفة المخططة */
  @Post(':id/release')
  @Permissions(PERMS.PRODUCTION_PLAN)
  release(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.orders.release(id, tenantId, userId);
  }

  /** صرف خامات (المتبقي كله إن لم تُذكر أسطر) — بالأقرب انتهاءً أو بدفعة مختارة */
  @Post(':id/issue')
  @Permissions(PERMS.PRODUCTION_EXECUTE)
  issue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IssueMaterialsDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.orders.issue(id, dto, tenantId, userId);
  }

  /** ردّ خامات لم تُستعمل (بتكلفة صرفها وإلى دفعاتها) */
  @Post(':id/return')
  @Permissions(PERMS.PRODUCTION_EXECUTE)
  returnMaterials(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnMaterialsDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.orders.returnMaterials(id, dto, tenantId, userId);
  }

  /** بدء تجهيز أو تشغيل أو توقف (بسببه) على خطوة */
  @Post(':id/time/start')
  @Permissions(PERMS.PRODUCTION_EXECUTE)
  startTime(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartTimeLogDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.orders.startTimeLog(id, dto, tenantId, userId);
  }

  /** تسجيل فترة بعد حدوثها بدقائقها */
  @Post(':id/time/manual')
  @Permissions(PERMS.PRODUCTION_EXECUTE)
  manualTime(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManualTimeLogDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.orders.manualTimeLog(id, dto, tenantId, userId);
  }

  /** إيقاف فترة مفتوحة بما أُنجز فيها وما رُفض */
  @Post(':id/time/:logId/stop')
  @Permissions(PERMS.PRODUCTION_EXECUTE)
  stopTime(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('logId', ParseUUIDPipe) logId: string,
    @Body() dto: StopTimeLogDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.orders.stopTimeLog(id, logId, dto, tenantId);
  }

  /** إنهاء خطوة (تُغلق فتراتها المفتوحة) */
  @Post(':id/operations/:operationId/finish')
  @Permissions(PERMS.PRODUCTION_EXECUTE)
  finishOperation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.orders.finishOperation(id, operationId, tenantId);
  }

  /** استلام ناتج جزئي، أو الأخير (final) الذي يُكمل الأمر ويحسب تكلفته الفعلية */
  @Post(':id/output')
  @Permissions(PERMS.PRODUCTION_EXECUTE)
  output(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProductionOutputDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.orders.output(id, dto, tenantId, userId);
  }

  /** إلغاء أمر بلا خامات مصروفة ولا ناتج */
  @Post(':id/cancel')
  @Permissions(PERMS.PRODUCTION_PLAN)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelProductionOrderDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.orders.cancel(id, dto, tenantId);
  }
}
