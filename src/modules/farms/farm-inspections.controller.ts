// src/modules/farms/farm-inspections.controller.ts
// فحص الآفات ومتابعة علاجها.
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import {
  CreateInspectionDto,
  InspectionQueryDto,
  InspectionStatusDto,
} from './dto/farm-work.dto';
import { FarmInspectionsService } from './farm-inspections.service';

const uuid = new ParseUUIDPipe();
@ApiTags(apiTag('FARM_WORK'))
@Controller('farm-inspections')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.FARMS_MODULE)
export class FarmInspectionsController {
  constructor(private readonly inspections: FarmInspectionsService) {}

  /** فحوص الآفات (المفتوحة والمعالجة والمنتهية) */
  @Get()
  @Permissions(PERMS.FARM_VIEW)
  findAll(
    @Query() query: InspectionQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.inspections.findAll(tenantId, query);
  }

  /** فحص واحد */
  @Get(':id')
  @Permissions(PERMS.FARM_VIEW)
  findOne(@Param('id', uuid) id: string, @CurrentTenantId() tenantId: string) {
    return this.inspections.findOne(id, tenantId);
  }

  /** تسجيل فحص آفة (النخلة المصابة تُعلَّم في السجل) */
  @Post()
  @Permissions(PERMS.FARM_WORK)
  create(
    @Body() dto: CreateInspectionDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.inspections.create(dto, tenantId, { userId });
  }

  /** متابعة الفحص: قيد العلاج ← انتهى (النخلة تعود سليمة) */
  @Post(':id/status')
  @Permissions(PERMS.FARM_WORK)
  setStatus(
    @Param('id', uuid) id: string,
    @Body() dto: InspectionStatusDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.inspections.setStatus(id, dto, tenantId, { userId });
  }
}
