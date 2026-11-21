// src/modules/manufacturing/work-centers.controller.ts
// مراكز العمل: الماكينات وخطوط الإنتاج وطاقتها وتكلفة ساعتها.
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
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import { FEATURES } from '../../common/constants/features';
import { PERMS } from '../../common/constants/permissions';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CreateWorkCenterDto,
  UpdateWorkCenterDto,
} from './dto/manufacturing.dto';
import { WorkCentersService } from './work-centers.service';

@ApiTags(apiTag('WORK_CENTERS'))
@Controller('manufacturing/work-centers')
@UseGuards(JwtAuthGuard, TenantScopeGuard, SubscriptionGuard, PermissionsGuard)
@RequiresFeature(FEATURES.MANUFACTURING_MODULE)
export class WorkCentersController {
  constructor(private readonly centers: WorkCentersService) {}

  /** مراكز العمل (الفعّالة والموقوفة) */
  @Get()
  @Permissions(PERMS.MANUFACTURING_VIEW)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.centers.findAll(tenantId);
  }

  /** مركز عمل واحد */
  @Get(':id')
  @Permissions(PERMS.MANUFACTURING_VIEW)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.centers.findOne(id, tenantId);
  }

  /** إضافة مركز عمل */
  @Post()
  @Permissions(PERMS.WORK_CENTER_MANAGE)
  create(
    @Body() dto: CreateWorkCenterDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.centers.create(dto, tenantId);
  }

  /** تعديل مركز عمل (أسعاره الجديدة تسري على الأوامر التي تُطلق بعدها) */
  @Patch(':id')
  @Permissions(PERMS.WORK_CENTER_MANAGE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkCenterDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.centers.update(id, dto, tenantId);
  }

  /** حذف مركز لم يُستعمل (المستعمل يوقَف) */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Permissions(PERMS.WORK_CENTER_MANAGE)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.centers.remove(id, tenantId);
  }
}
