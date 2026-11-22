// src/modules/farms/farms.controller.ts
// المزارع: الأرض، شجرة وحداتها (قطاع، حوش، صف، صوبة...)، مصادر المياه،
// الطقس، والخريطة بحالة كل وحدة.
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
  BulkFarmUnitsDto,
  CreateFarmDto,
  CreateFarmUnitDto,
  UpdateFarmDto,
  UpdateFarmUnitDto,
  UpdateWaterSourceDto,
  WaterSourceDto,
  WeatherLogDto,
  WeatherQueryDto,
} from './dto/farms.dto';
import { FarmsService } from './farms.service';

const uuid = new ParseUUIDPipe();

@ApiTags(apiTag('FARMS'))
@Controller('farms')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.FARMS_MODULE)
export class FarmsController {
  constructor(private readonly farms: FarmsService) {}

  /** المزارع بأرقامها: الوحدات، الزراعات القائمة، النخيل، والإصابات المفتوحة */
  @Get()
  @Permissions(PERMS.FARM_VIEW)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.farms.findAll(tenantId);
  }

  /** مزرعة واحدة */
  @Get(':id')
  @Permissions(PERMS.FARM_VIEW)
  findOne(@Param('id', uuid) id: string, @CurrentTenantId() tenantId: string) {
    return this.farms.findOne(id, tenantId);
  }

  /** إضافة مزرعة (حدودها على الخريطة اختيارية — منها المساحة) */
  @Post()
  @Permissions(PERMS.FARM_MANAGE)
  create(@Body() dto: CreateFarmDto, @CurrentTenantId() tenantId: string) {
    return this.farms.create(dto, tenantId);
  }

  /** تعديل مزرعة */
  @Patch(':id')
  @Permissions(PERMS.FARM_MANAGE)
  update(
    @Param('id', uuid) id: string,
    @Body() dto: UpdateFarmDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.farms.update(id, dto, tenantId);
  }

  /** حذف مزرعة بلا زراعات ولا عمل (غيرها تُوقف) */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(PERMS.FARM_MANAGE)
  remove(@Param('id', uuid) id: string, @CurrentTenantId() tenantId: string) {
    return this.farms.remove(id, tenantId);
  }

  /** الخريطة: حدود كل وحدة وحالتها (محتاج ري، إصابة، فترة أمان، جاهز للجني) */
  @Get(':id/map')
  @Permissions(PERMS.FARM_VIEW)
  map(@Param('id', uuid) id: string, @CurrentTenantId() tenantId: string) {
    return this.farms.map(id, tenantId);
  }

  // ─── الوحدات ───

  /** وحدات المزرعة بترتيب الشجرة */
  @Get(':id/units')
  @Permissions(PERMS.FARM_VIEW)
  units(@Param('id', uuid) id: string, @CurrentTenantId() tenantId: string) {
    return this.farms.listUnits(id, tenantId);
  }

  /** إضافة وحدة (تحت المزرعة أو تحت وحدة) */
  @Post(':id/units')
  @Permissions(PERMS.FARM_MANAGE)
  createUnit(
    @Param('id', uuid) id: string,
    @Body() dto: CreateFarmUnitDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.farms.createUnit(id, dto, tenantId);
  }

  /** وحدات متتالية مرة واحدة ("صف 1" … "صف 40") */
  @Post(':id/units/bulk')
  @Permissions(PERMS.FARM_MANAGE)
  bulkUnits(
    @Param('id', uuid) id: string,
    @Body() dto: BulkFarmUnitsDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.farms.bulkUnits(id, dto, tenantId);
  }

  /** تعديل وحدة (تغيير الأب ينقلها بما تحتها) */
  @Patch(':id/units/:unitId')
  @Permissions(PERMS.FARM_MANAGE)
  updateUnit(
    @Param('id', uuid) id: string,
    @Param('unitId', uuid) unitId: string,
    @Body() dto: UpdateFarmUnitDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.farms.updateUnit(id, unitId, dto, tenantId);
  }

  /** حذف وحدة فارغة (المستعملة توقف) */
  @Delete(':id/units/:unitId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(PERMS.FARM_MANAGE)
  removeUnit(
    @Param('id', uuid) id: string,
    @Param('unitId', uuid) unitId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.farms.removeUnit(id, unitId, tenantId);
  }

  // ─── مصادر المياه ───

  /** مصادر مياه المزرعة */
  @Get(':id/water-sources')
  @Permissions(PERMS.FARM_VIEW)
  waterSources(
    @Param('id', uuid) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.farms.listWaterSources(id, tenantId);
  }

  /** إضافة مصدر مياه (بئر، شبكة، خزان...) */
  @Post(':id/water-sources')
  @Permissions(PERMS.FARM_MANAGE)
  createWaterSource(
    @Param('id', uuid) id: string,
    @Body() dto: WaterSourceDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.farms.createWaterSource(id, dto, tenantId);
  }

  /** تعديل مصدر مياه */
  @Patch(':id/water-sources/:sourceId')
  @Permissions(PERMS.FARM_MANAGE)
  updateWaterSource(
    @Param('id', uuid) id: string,
    @Param('sourceId', uuid) sourceId: string,
    @Body() dto: UpdateWaterSourceDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.farms.updateWaterSource(id, sourceId, dto, tenantId);
  }

  /** حذف مصدر مياه */
  @Delete(':id/water-sources/:sourceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(PERMS.FARM_MANAGE)
  removeWaterSource(
    @Param('id', uuid) id: string,
    @Param('sourceId', uuid) sourceId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.farms.removeWaterSource(id, sourceId, tenantId);
  }

  // ─── الطقس ───

  /** طقس المزرعة بالأيام */
  @Get(':id/weather')
  @Permissions(PERMS.FARM_VIEW)
  weather(
    @Param('id', uuid) id: string,
    @Query() query: WeatherQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.farms.listWeather(id, query, tenantId);
  }

  /** طقس يوم (يُستبدل إن سُجّل لنفس اليوم) */
  @Post(':id/weather')
  @Permissions(PERMS.FARM_WORK)
  upsertWeather(
    @Param('id', uuid) id: string,
    @Body() dto: WeatherLogDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.farms.upsertWeather(id, dto, tenantId);
  }

  /** حذف سجل طقس */
  @Delete(':id/weather/:logId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(PERMS.FARM_WORK)
  removeWeather(
    @Param('id', uuid) id: string,
    @Param('logId', uuid) logId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.farms.removeWeather(id, logId, tenantId);
  }
}
