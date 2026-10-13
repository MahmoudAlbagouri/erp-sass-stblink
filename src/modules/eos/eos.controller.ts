// src/modules/eos/eos.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import { EOSService } from './eos.service';
import { CreateEOSDto } from './dto/create-eos.dto';
import { UpdateEOSDto } from './dto/update-eos.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { SubscriptionGuard } from '../../common/guards/subscription.guard'; // ✅ استيراد الحارس
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequiresFeature } from '../../common/decorators/requires-feature.decorator'; // ✅ استيراد ديكوراتور الميزة
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { PERMS } from '../../common/constants/permissions';
import { FEATURES } from '../../common/constants/features'; // ✅ استيراد الثوابت

@ApiTags(apiTag('EOS'))
@Controller('eos')
@UseGuards(JwtAuthGuard, SubscriptionGuard) // ✅ تفعيل حراس الاشتراك والمصادقة
export class EOSController {
  constructor(private readonly eosService: EOSService) {}

  /** حساب وتسجيل مكافأة نهاية خدمة لموظف */
  @Post()
  @Permissions(PERMS.EOS_CREATE)
  @RequiresFeature(FEATURES.SETTLEMENTS_MODULE) // ✅ التحقق من توفر موديول التسويات
  @UseGuards(PermissionsGuard)
  create(@Body() dto: CreateEOSDto, @CurrentTenantId() tenantId: string) {
    return this.eosService.create(dto, tenantId);
  }

  /** قائمة تسويات نهاية الخدمة */
  @Get()
  @Permissions(PERMS.EOS_VIEW)
  @RequiresFeature(FEATURES.SETTLEMENTS_MODULE) // ✅ حماية عرض القائمة
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.eosService.findAll(tenantId);
  }

  /** تسوية نهاية خدمة واحدة */
  @Get(':id')
  @Permissions(PERMS.EOS_VIEW)
  @RequiresFeature(FEATURES.SETTLEMENTS_MODULE) // ✅ حماية عرض التفاصيل
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.eosService.findOne(id, tenantId);
  }

  /** تعديل تسوية نهاية خدمة */
  @Patch(':id')
  @Permissions(PERMS.EOS_UPDATE)
  @RequiresFeature(FEATURES.SETTLEMENTS_MODULE) // ✅ حماية التعديل
  @UseGuards(PermissionsGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEOSDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.eosService.update(id, dto, tenantId);
  }

  /** حذف تسوية نهاية خدمة */
  @Delete(':id')
  @Permissions(PERMS.EOS_DELETE)
  @RequiresFeature(FEATURES.SETTLEMENTS_MODULE) // ✅ حماية الحذف
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.eosService.remove(id, tenantId);
  }
}
