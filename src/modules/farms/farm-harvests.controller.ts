// src/modules/farms/farm-harvests.controller.ts
// الحصاد: يدخل المخزن بدفعة وقيمته.
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
  CreateHarvestDto,
  HarvestQueryDto,
  VoidHarvestDto,
} from './dto/farm-work.dto';
import { FarmHarvestsService } from './farm-harvests.service';

const uuid = new ParseUUIDPipe();
@ApiTags(apiTag('FARM_WORK'))
@Controller('farm-harvests')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.FARMS_MODULE)
export class FarmHarvestsController {
  constructor(private readonly harvests: FarmHarvestsService) {}

  /** الحصاد (بالمزرعة والوحدة والزراعة والنخلة والفترة) */
  @Get()
  @Permissions(PERMS.FARM_VIEW)
  findAll(
    @Query() query: HarvestQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.harvests.findAll(tenantId, query);
  }

  /** حصاد واحد */
  @Get(':id')
  @Permissions(PERMS.FARM_VIEW)
  findOne(@Param('id', uuid) id: string, @CurrentTenantId() tenantId: string) {
    return this.harvests.findOne(id, tenantId);
  }

  /** تسجيل حصاد: يدخل المخزن بدفعة وقيمته (المكتوبة، المعيارية، أو المتوسط) */
  @Post()
  @Permissions(PERMS.FARM_WORK)
  create(
    @Body() dto: CreateHarvestDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.harvests.create(dto, tenantId, { userId });
  }

  /** إلغاء حصاد سُجّل خطأً (يخرج من دفعته ويُعكس قيده) */
  @Post(':id/void')
  @Permissions(PERMS.FARM_WORK)
  void(
    @Param('id', uuid) id: string,
    @Body() dto: VoidHarvestDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.harvests.void(id, dto, tenantId, { userId });
  }
}
