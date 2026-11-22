// src/modules/farms/farm-plants.controller.ts
// سجل النخيل والأشجار: نخلة نخلة بتاريخها.
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
import { PlantQueryDto, PlantStatusDto, UpdatePlantDto } from './dto/crops.dto';
import { PlantingsService } from './plantings.service';

const uuid = new ParseUUIDPipe();

@ApiTags(apiTag('FARM_CROPS'))
@Controller('farm-plants')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.FARMS_MODULE)
export class FarmPlantsController {
  constructor(private readonly plantings: PlantingsService) {}

  /** سجل النخيل والأشجار (بالوسم، الوحدة وما تحتها، الصنف، الحالة، الجنس) */
  @Get()
  @Permissions(PERMS.FARM_VIEW)
  findAll(@Query() query: PlantQueryDto, @CurrentTenantId() tenantId: string) {
    return this.plantings.findPlants(tenantId, query);
  }

  /** النخلة وتاريخها: حالاتها، إنتاجها بالسنة، عملياتها، فحوصها، فسائلها */
  @Get(':id')
  @Permissions(PERMS.FARM_VIEW)
  findOne(@Param('id', uuid) id: string, @CurrentTenantId() tenantId: string) {
    return this.plantings.plantDetail(id, tenantId);
  }

  /** تعديل بيانات نخلة (الوسم، الموقع، الجنس، تاريخ الغرس) */
  @Patch(':id')
  @Permissions(PERMS.FARM_MANAGE)
  update(
    @Param('id', uuid) id: string,
    @Body() dto: UpdatePlantDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.plantings.updatePlant(id, dto, tenantId);
  }

  /** حالة النخلة (أُصيبت، تعافت، ماتت، قُلعت) — تُسجَّل في تاريخها */
  @Post(':id/status')
  @Permissions(PERMS.FARM_WORK)
  setStatus(
    @Param('id', uuid) id: string,
    @Body() dto: PlantStatusDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.plantings.setPlantStatus(id, dto, tenantId, userId);
  }
}
