// src/modules/inventory/lots.controller.ts
// الدفعات وتواريخ الانتهاء: الأرصدة، التتبع، والرصيد غير المعيّن.
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
  AssignLotDto,
  AvailableLotsQueryDto,
  LotQueryDto,
  UpdateLotDto,
} from './dto/lots.dto';
import { LotsService } from './lots.service';

@ApiTags(apiTag('LOTS'))
@Controller('inventory/lots')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.LOT_TRACKING)
export class LotsController {
  constructor(private readonly lots: LotsService) {}

  /** الدفعات بأرصدتها وتواريخ انتهائها (ذات الرصيد افتراضياً) */
  @Get()
  @Permissions(PERMS.LOT_VIEW)
  findAll(@Query() query: LotQueryDto, @CurrentTenantId() tenantId: string) {
    return this.lots.findAll(tenantId, query);
  }

  /** المنتهية والقاربة على الانتهاء وفيها رصيد، بقيمتها */
  @Get('summary')
  @Permissions(PERMS.LOT_VIEW)
  summary(@CurrentTenantId() tenantId: string, @Query() query: LotQueryDto) {
    return this.lots.summary(tenantId, query.days);
  }

  /** دفعات صنف ذات رصيد في مخزن بترتيب الصرف (الأقرب انتهاءً) — لاختيار دفعة */
  @Get('available')
  @Permissions(PERMS.INVENTORY_VIEW)
  available(
    @Query() query: AvailableLotsQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.lots.available(tenantId, query.productId, query.warehouseId);
  }

  /** الأصناف المتتبعة التي لها رصيد بلا دفعة */
  @Get('unassigned')
  @Permissions(PERMS.LOT_VIEW)
  unassigned(
    @CurrentTenantId() tenantId: string,
    @Query('warehouseId', new ParseUUIDPipe({ optional: true }))
    warehouseId?: string,
  ) {
    return this.lots.unassigned(tenantId, warehouseId);
  }

  /** تعيين رصيد غير معيّن لدفعة (رصيد سبق تفعيل التتبع) — الرصيد لا يتغير */
  @Post('assign')
  @Permissions(PERMS.LOT_MANAGE)
  assign(
    @Body() dto: AssignLotDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.lots.assign(dto, tenantId, userId);
  }

  /** الدفعة ورحلتها: مصدرها، وكل حركة عليها ومستندها وعميلها أو مورّدها */
  @Get(':id')
  @Permissions(PERMS.LOT_VIEW)
  trace(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.lots.trace(id, tenantId);
  }

  /** تصحيح تاريخ الانتهاء أو الإنتاج أو الملاحظة */
  @Patch(':id')
  @Permissions(PERMS.LOT_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLotDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.lots.update(id, dto, tenantId);
  }
}
