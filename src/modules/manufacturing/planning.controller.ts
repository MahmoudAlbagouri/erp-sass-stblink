// src/modules/manufacturing/planning.controller.ts
// تخطيط المصنع: الاحتياجات (MRP)، حمل المراكز، والأداء.
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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
  DateRangeQueryDto,
  MrpPurchaseDraftsDto,
  MrpQueryDto,
} from './dto/manufacturing.dto';
import { PlanningService } from './planning.service';

@ApiTags(apiTag('MANUFACTURING_PLANNING'))
@Controller('manufacturing/planning')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.MANUFACTURING_MODULE)
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  /** تخطيط الاحتياجات متعدد المستويات: ما ينقص، يُشترى أم يُصنَّع، ومن أي مورد ومتى */
  @Get('mrp')
  @Permissions(PERMS.PRODUCTION_PLAN)
  mrp(@Query() query: MrpQueryDto, @CurrentTenantId() tenantId: string) {
    return this.planning.mrp(tenantId, query);
  }

  /** مسودات فواتير شراء من نقص التخطيط (مسودة لكل مورد بتاريخ طلب اليوم) */
  @Post('mrp/purchase-drafts')
  @Permissions(PERMS.PRODUCTION_PLAN, PERMS.PURCHASE_MANAGE)
  purchaseDrafts(
    @Body() dto: MrpPurchaseDraftsDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.planning.createPurchaseDrafts(dto, tenantId, userId);
  }

  /** حمل مراكز العمل يوماً بيوم مقابل طاقتها (حتى 92 يوماً) */
  @Get('capacity')
  @Permissions(PERMS.MANUFACTURING_VIEW)
  capacity(
    @Query() query: DateRangeQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.planning.capacity(tenantId, query);
  }

  /** أداء المصنع لفترة: التكلفة المخططة والفعلية، الهالك والتوقف بأسبابهما، وكفاءة المراكز */
  @Get('performance')
  @Permissions(PERMS.MANUFACTURING_VIEW)
  performance(
    @Query() query: DateRangeQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.planning.performance(tenantId, query);
  }
}
