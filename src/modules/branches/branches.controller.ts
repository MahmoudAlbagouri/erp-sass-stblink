// src/modules/branches/branches.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import { PERMS } from '../../common/constants/permissions';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantScopeGuard } from '../../common/guards/tenant-scope.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BranchesService } from './branches.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

/**
 * الفروع متاحة لكل الشركات مهما كانت باقتها: شركة تستخدم الموارد البشرية فقط
 * لها فروع كما لشركة تبيع.
 */
@ApiTags(apiTag('BRANCHES'))
@Controller('branches')
@UseGuards(JwtAuthGuard, TenantScopeGuard)
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  /**
   * قائمة مختصرة لقوائم الاختيار (نموذج موظف، مخزن، جهاز، فلتر تقرير): تكفيها
   * المصادقة، فمن يضيف موظفاً يحتاج اختيار فرعه دون صلاحية إدارة الفروع.
   */
  @Get('options')
  async options(@CurrentTenantId() tenantId: string) {
    const branches = await this.branches.findAll(tenantId);
    return branches.map(({ id, name, code, isMain, isActive }) => ({
      id,
      name,
      code,
      isMain,
      isActive,
    }));
  }

  /** قائمة الفروع مع عدد مخازنها وموظفيها وأجهزتها ومستخدميها */
  @Get()
  @Permissions(PERMS.BRANCH_VIEW)
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.branches.findAllWithCounts(tenantId);
  }

  /** إضافة فرع */
  @Post()
  @Permissions(PERMS.BRANCH_MANAGE)
  @UseGuards(PermissionsGuard)
  create(@Body() dto: CreateBranchDto, @CurrentTenantId() tenantId: string) {
    return this.branches.create(dto, tenantId);
  }

  /** تعديل فرع أو إيقافه */
  @Patch(':id')
  @Permissions(PERMS.BRANCH_MANAGE)
  @UseGuards(PermissionsGuard)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.branches.update(id, dto, tenantId);
  }

  /** حذف فرع (بلا مخازن ولا مستخدمين مقيَّدين به) */
  @Delete(':id')
  @Permissions(PERMS.BRANCH_MANAGE)
  @UseGuards(PermissionsGuard)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.branches.remove(id, tenantId);
  }
}
