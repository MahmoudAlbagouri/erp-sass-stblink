// src/modules/tenants/tenants.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../../common/guards/system-admin.guard';
import { SystemAdmin } from '../../common/decorators/system-admin.decorator';
import {
  CurrentUser,
  type CurrentUserData,
} from '../../common/decorators/current-user.decorator';

/**
 * ✅ إدارة الشركات (إنشاء / عرض الكل / حذف) محجوزة لمالك النظام.
 * مدير الشركة يستطيع عرض وتعديل بيانات شركته فقط.
 */
@ApiTags(apiTag('TENANTS'))
@Controller('tenants')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  private assertCanAccessTenant(
    tenantId: string,
    user: CurrentUserData,
    requireAdmin = false,
  ): void {
    if (user.isSystemAdmin) return;

    const isOwnTenant = user.tenantId === tenantId;
    if (!isOwnTenant || (requireAdmin && !user.isSuperAdmin)) {
      throw new ForbiddenException('لا تملك صلاحية الوصول لهذه الشركة');
    }
  }

  /** إضافة شركة (لمالك النظام) */
  @Post()
  @SystemAdmin()
  create(@Body() createTenantDto: CreateTenantDto) {
    return this.tenantsService.create(createTenantDto);
  }

  /** قائمة الشركات (لمالك النظام) */
  @Get()
  @SystemAdmin()
  findAll() {
    return this.tenantsService.findAll();
  }

  /** شركة واحدة */
  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserData) {
    this.assertCanAccessTenant(id, user);
    return this.tenantsService.findOne(id);
  }

  /** تعديل بيانات شركة (الدولة تحدد عملتها ومنطقتها الزمنية) */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateTenantDto: UpdateTenantDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    this.assertCanAccessTenant(id, user, true);
    // الدولة تحدد عملة كل مبالغ الشركة: تغييرها بعد الإنشاء لمالك النظام فقط
    if (
      !user.isSystemAdmin &&
      updateTenantDto.country &&
      updateTenantDto.country !== user.country
    ) {
      throw new ForbiddenException(
        'لا يمكن تغيير دولة الشركة بعد إنشائها. تواصل مع الدعم.',
      );
    }
    return this.tenantsService.update(id, updateTenantDto);
  }

  /** حذف شركة (لمالك النظام) */
  @Delete(':id')
  @SystemAdmin()
  async remove(@Param('id') id: string) {
    await this.tenantsService.remove(id);
    return { message: 'تم حذف الشركة وجميع بياناتها المرتبطة بنجاح' };
  }
}
