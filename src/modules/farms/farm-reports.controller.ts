// src/modules/farms/farm-reports.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
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
import { FarmReportQueryDto } from './dto/farm-work.dto';
import { FarmReportsService } from './farm-reports.service';

@ApiTags(apiTag('FARM_REPORTS'))
@Controller('farm-reports')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.FARMS_MODULE)
export class FarmReportsController {
  constructor(private readonly reports: FarmReportsService) {}

  /** لوحة المزرعة: المتأخر والقادم، الإصابات، حصاد السنة وتكلفتها، والمياه */
  @Get('dashboard')
  @Permissions(PERMS.FARM_VIEW)
  dashboard(
    @Query() query: FarmReportQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.reports.dashboard(query, tenantId);
  }

  /** الإنتاجية مقابل المتوقع (groupBy: planting | variety | unit | plant | type | month) */
  @Get('yield')
  @Permissions(PERMS.FARM_REPORTS_VIEW)
  yields(
    @Query() query: FarmReportQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.reports.yields(query, tenantId);
  }

  /** التكلفة مقابل الحصاد: تكلفة الكيلو والهامش (groupBy: planting | type | month) */
  @Get('costs')
  @Permissions(PERMS.FARM_REPORTS_VIEW)
  costs(
    @Query() query: FarmReportQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.reports.costs(query, tenantId);
  }

  /** الآفات: بالآفة والشهر والوحدة ونسبة الإصابة */
  @Get('pests')
  @Permissions(PERMS.FARM_REPORTS_VIEW)
  pests(
    @Query() query: FarmReportQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.reports.pests(query, tenantId);
  }

  /** سجل النخيل: بالصنف والحالة والجنس والعمر، وما أُزيل ولماذا */
  @Get('registry')
  @Permissions(PERMS.FARM_REPORTS_VIEW)
  registry(
    @Query() query: FarmReportQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.reports.registry(query, tenantId);
  }

  /** المياه: بالوحدة والمصدر والشهر ولكل هكتار */
  @Get('water')
  @Permissions(PERMS.FARM_REPORTS_VIEW)
  water(
    @Query() query: FarmReportQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.reports.water(query, tenantId);
  }
}
