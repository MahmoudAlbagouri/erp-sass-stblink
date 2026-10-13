// src/modules/dashboard/dashboard.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import type { CurrentUserData } from '../../common/types/auth.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DASHBOARD_RANGES, DashboardService } from './dashboard.service';

const DAY_RULE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MESSAGE = 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD';

export class DashboardQueryDto {
  /** آخر N يوماً حتى اليوم (الافتراضي 30) */
  @IsOptional()
  @Type(() => Number)
  @IsIn([...DASHBOARD_RANGES], {
    message: `الفترة يجب أن تكون أحد: ${DASHBOARD_RANGES.join('، ')} يوماً`,
  })
  days?: number;

  /** فترة مخصصة: البداية والنهاية معاً، ولها الأولوية على `days` */
  @IsOptional()
  @Matches(DAY_RULE, { message: DAY_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(DAY_RULE, { message: DAY_MESSAGE })
  to?: string;

  /** فرع واحد بدل كل الفروع */
  @IsOptional()
  @IsUUID(undefined, { message: 'الفرع المختار غير صالح' })
  warehouseId?: string;
}

/**
 * الصفحة الرئيسية. بلا حارس صلاحية أو خطة على المسار نفسه: أي مستخدم شركة يفتح
 * الرئيسية، والخدمة تُسقط كل قسم لا يحق له (انظر DashboardService.accessOf).
 */
@Controller('dashboard')
@UseGuards(JwtAuthGuard, TenantScopeGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  overview(
    @CurrentUser() user: CurrentUserData,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboard.overview(user, query);
  }
}
