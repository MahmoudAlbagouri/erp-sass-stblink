// src/modules/farms/farm-operations.controller.ts
// العمليات الزراعية: المخطط والمنفّذ ومدخلاته وعماله.
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
  CancelOperationDto,
  CompleteOperationDto,
  CreateOperationDto,
  GenerateFarmPlanDto,
  OperationQueryDto,
} from './dto/farm-work.dto';
import { FarmOperationsService } from './farm-operations.service';
import { FarmPlanService } from './farm-plan.service';

const uuid = new ParseUUIDPipe();
@ApiTags(apiTag('FARM_WORK'))
@Controller('farm-operations')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.FARMS_MODULE)
export class FarmOperationsController {
  constructor(
    private readonly operations: FarmOperationsService,
    private readonly plan: FarmPlanService,
  ) {}

  /** العمليات (المخططة والمنفّذة والملغاة) — due=overdue|upcoming للمتأخر والقادم */
  @Get()
  @Permissions(PERMS.FARM_VIEW)
  findAll(
    @Query() query: OperationQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.operations.findAll(tenantId, query);
  }

  /** عملية بمدخلاتها وعمالها ونخيلها */
  @Get(':id')
  @Permissions(PERMS.FARM_VIEW)
  findOne(@Param('id', uuid) id: string, @CurrentTenantId() tenantId: string) {
    return this.operations.findOne(id, tenantId);
  }

  /** تسجيل عملية: مخططة لموعد، أو منفّذة (مدخلاتها تخرج من المخزن بتكلفتها) */
  @Post()
  @Permissions(PERMS.FARM_WORK)
  create(
    @Body() dto: CreateOperationDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.operations.create(dto, tenantId, { userId });
  }

  /** خطة السنة من التقويم الزراعي لكل زراعات المزرعة */
  @Post('generate')
  @Permissions(PERMS.FARM_MANAGE)
  generate(
    @Body() dto: GenerateFarmPlanDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.plan.forFarm(dto.farmId, tenantId, dto.year);
  }

  /** إتمام عملية مخططة بما نُفّذ فعلاً */
  @Post(':id/complete')
  @Permissions(PERMS.FARM_WORK)
  complete(
    @Param('id', uuid) id: string,
    @Body() dto: CompleteOperationDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.operations.complete(id, dto, tenantId, { userId });
  }

  /** إلغاء مخطط، أو إبطال منفّذ (تعود مدخلاته للمخزن ويُعكس قيده) */
  @Post(':id/cancel')
  @Permissions(PERMS.FARM_WORK)
  cancel(
    @Param('id', uuid) id: string,
    @Body() dto: CancelOperationDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.operations.cancel(id, dto, tenantId, { userId });
  }
}
