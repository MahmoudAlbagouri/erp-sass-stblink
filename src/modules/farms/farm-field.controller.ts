// src/modules/farms/farm-field.controller.ts
// الشاشة الميدانية بلا إنترنت: التنزيل والرفع.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { FieldBootstrapQueryDto, FieldSyncDto } from './dto/farm-work.dto';
import { FarmFieldService } from './farm-field.service';

@ApiTags(apiTag('FARM_WORK'))
@Controller('farm-field')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.FARMS_MODULE)
export class FarmFieldController {
  constructor(private readonly field: FarmFieldService) {}

  /** تنزيل الشاشة الميدانية: الوحدات، الزراعات، النخيل، المدخلات، العمال، المخطط */
  @Get('bootstrap')
  @Permissions(PERMS.FARM_WORK)
  bootstrap(
    @Query() query: FieldBootstrapQueryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.field.bootstrap(query, tenantId);
  }

  /** رفع ما سُجّل في الأرض بلا إنترنت (حتى 200 عملية، كل واحدة وحدها) */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Permissions(PERMS.FARM_WORK)
  sync(
    @Body() dto: FieldSyncDto,
    @CurrentTenantId() tenantId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.field.sync(dto, tenantId, userId);
  }
}
