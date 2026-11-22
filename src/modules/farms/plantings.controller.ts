// src/modules/farms/plantings.controller.ts
// الزراعات: على وحدة، بحالاتها ونهايتها وسببها، وخطة تقويمها.
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
import { DataSource } from 'typeorm';
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
import {
  ActivatePlantingDto,
  BulkPlantsDto,
  ClosePlantingDto,
  CreatePlantDto,
  CreatePlantingDto,
  GeneratePlanDto,
  PlantingQueryDto,
  UpdatePlantingDto,
} from './dto/crops.dto';
import { FarmPlanService } from './farm-plan.service';
import { PlantingsService } from './plantings.service';

const uuid = new ParseUUIDPipe();

@ApiTags(apiTag('FARM_CROPS'))
@Controller('plantings')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.FARMS_MODULE)
export class PlantingsController {
  constructor(
    private readonly plantings: PlantingsService,
    private readonly plan: FarmPlanService,
    private readonly dataSource: DataSource,
  ) {}

  /** الزراعات (فلترة بالمزرعة والوحدة وما تحتها والمحصول والحالة) */
  @Get()
  @Permissions(PERMS.FARM_VIEW)
  findAll(
    @Query() query: PlantingQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.plantings.findAll(tenantId, query);
  }

  /** الزراعة: نخيلها بحالاتها، حصادها، عملياتها وتكلفتها، والمتوقع */
  @Get(':id')
  @Permissions(PERMS.FARM_VIEW)
  findOne(@Param('id', uuid) id: string, @CurrentTenantId() tenantId: string) {
    return this.plantings.findOne(id, tenantId);
  }

  /** زراعة جديدة على وحدة */
  @Post()
  @Permissions(PERMS.FARM_MANAGE)
  create(@Body() dto: CreatePlantingDto, @CurrentTenantId() tenantId: string) {
    return this.plantings.create(dto, tenantId);
  }

  /** تعديل زراعة */
  @Patch(':id')
  @Permissions(PERMS.FARM_MANAGE)
  update(
    @Param('id', uuid) id: string,
    @Body() dto: UpdatePlantingDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.plantings.update(id, dto, tenantId);
  }

  /** زراعة مخططة زُرعت فعلاً */
  @Post(':id/activate')
  @Permissions(PERMS.FARM_MANAGE)
  activate(
    @Param('id', uuid) id: string,
    @Body() dto: ActivatePlantingDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.plantings.activate(id, dto, tenantId);
  }

  /** إنهاء زراعة بسببها (حُصدت، فشلت، قُلعت) */
  @Post(':id/close')
  @Permissions(PERMS.FARM_MANAGE)
  close(
    @Param('id', uuid) id: string,
    @Body() dto: ClosePlantingDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.plantings.close(id, dto, tenantId, userId);
  }

  /** حذف زراعة مخططة لم يُعمل فيها شيء */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(PERMS.FARM_MANAGE)
  remove(@Param('id', uuid) id: string, @CurrentTenantId() tenantId: string) {
    return this.plantings.remove(id, tenantId);
  }

  /** عمليات التقويم الزراعي المخططة للزراعة (للسنة المطلوبة للمعمّر) */
  @Post(':id/plan')
  @Permissions(PERMS.FARM_MANAGE)
  async generatePlan(
    @Param('id', uuid) id: string,
    @Body() dto: GeneratePlanDto,
    @CurrentTenantId() tenantId: string,
  ) {
    const created = await this.dataSource.transaction(async (manager) => {
      const planting = await this.plantings.plantingOf(manager, id, tenantId);
      return this.plan.forPlanting(manager, planting, tenantId, dto.year);
    });
    return { created };
  }

  /** تسجيل نخيل صفوف دفعة واحدة (ترقيم ووسم تلقائي) */
  @Post(':id/plants/bulk')
  @Permissions(PERMS.FARM_MANAGE)
  bulkPlants(
    @Param('id', uuid) id: string,
    @Body() dto: BulkPlantsDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.plantings.bulkPlants(id, dto, tenantId, userId);
  }

  /** نبتة واحدة: فسيلة غُرست، أو بديل لنخلة ماتت في موقعها */
  @Post(':id/plants')
  @Permissions(PERMS.FARM_MANAGE)
  createPlant(
    @Param('id', uuid) id: string,
    @Body() dto: CreatePlantDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.plantings.createPlant(id, dto, tenantId, userId);
  }
}
