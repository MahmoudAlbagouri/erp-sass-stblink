// src/modules/farms/crops.controller.ts
// المحاصيل وأصنافها وتقويمها الزراعي.
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
import { CropsService } from './crops.service';
import {
  CalendarStepDto,
  CreateCropDto,
  CropVarietyDto,
  UpdateCalendarStepDto,
  UpdateCropDto,
  UpdateCropVarietyDto,
} from './dto/crops.dto';

const uuid = new ParseUUIDPipe();

@ApiTags(apiTag('FARM_CROPS'))
@Controller('farm-crops')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.FARMS_MODULE)
export class CropsController {
  constructor(private readonly crops: CropsService) {}

  /** المحاصيل بأصنافها */
  @Get()
  @Permissions(PERMS.FARM_VIEW)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.crops.findAll(tenantId);
  }

  /** محصول واحد بأصنافه */
  @Get(':id')
  @Permissions(PERMS.FARM_VIEW)
  findOne(@Param('id', uuid) id: string, @CurrentTenantId() tenantId: string) {
    return this.crops.findOne(id, tenantId);
  }

  /** إضافة محصول (النخيل: نخلة نخلة، الأشجار: بالعدد، الباقي: بالمساحة) */
  @Post()
  @Permissions(PERMS.FARM_MANAGE)
  create(@Body() dto: CreateCropDto, @CurrentTenantId() tenantId: string) {
    return this.crops.create(dto, tenantId);
  }

  /** تعديل محصول */
  @Patch(':id')
  @Permissions(PERMS.FARM_MANAGE)
  update(
    @Param('id', uuid) id: string,
    @Body() dto: UpdateCropDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.crops.update(id, dto, tenantId);
  }

  /** حذف محصول لم يُزرع */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(PERMS.FARM_MANAGE)
  remove(@Param('id', uuid) id: string, @CurrentTenantId() tenantId: string) {
    return this.crops.remove(id, tenantId);
  }

  /** إضافة صنف (برحي، سكري...) بمنتج حصاده وإنتاجيته المتوقعة */
  @Post(':id/varieties')
  @Permissions(PERMS.FARM_MANAGE)
  addVariety(
    @Param('id', uuid) id: string,
    @Body() dto: CropVarietyDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.crops.addVariety(id, dto, tenantId);
  }

  /** تعديل صنف */
  @Patch(':id/varieties/:varietyId')
  @Permissions(PERMS.FARM_MANAGE)
  updateVariety(
    @Param('id', uuid) id: string,
    @Param('varietyId', uuid) varietyId: string,
    @Body() dto: UpdateCropVarietyDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.crops.updateVariety(id, varietyId, dto, tenantId);
  }

  /** حذف صنف لم يُزرع */
  @Delete(':id/varieties/:varietyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(PERMS.FARM_MANAGE)
  removeVariety(
    @Param('id', uuid) id: string,
    @Param('varietyId', uuid) varietyId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.crops.removeVariety(id, varietyId, tenantId);
  }

  /** التقويم الزراعي للمحصول */
  @Get(':id/calendar')
  @Permissions(PERMS.FARM_VIEW)
  calendar(@Param('id', uuid) id: string, @CurrentTenantId() tenantId: string) {
    return this.crops.listSteps(id, tenantId);
  }

  /** خطوة في التقويم (بعد الزرع بأيام، أو في شهر ويوم كل سنة) */
  @Post(':id/calendar')
  @Permissions(PERMS.FARM_MANAGE)
  addStep(
    @Param('id', uuid) id: string,
    @Body() dto: CalendarStepDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.crops.addStep(id, dto, tenantId);
  }

  /** تعديل خطوة */
  @Patch(':id/calendar/:stepId')
  @Permissions(PERMS.FARM_MANAGE)
  updateStep(
    @Param('id', uuid) id: string,
    @Param('stepId', uuid) stepId: string,
    @Body() dto: UpdateCalendarStepDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.crops.updateStep(id, stepId, dto, tenantId);
  }

  /** حذف خطوة (ما وُلّد منها يبقى) */
  @Delete(':id/calendar/:stepId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(PERMS.FARM_MANAGE)
  removeStep(
    @Param('id', uuid) id: string,
    @Param('stepId', uuid) stepId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.crops.removeStep(id, stepId, tenantId);
  }
}
