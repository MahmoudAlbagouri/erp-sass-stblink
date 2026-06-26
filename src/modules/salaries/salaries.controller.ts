// src/modules/salaries/salaries.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
} from '@nestjs/common';
import { SalariesService } from './salaries.service';
import { CreateSalaryDto } from './dto/create-salary.dto';
import { UpdateSalaryDto } from './dto/update-salary.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
// ✅ استيراد الثوابت
import { PERMS } from 'src/common/constants/permissions';

@Controller('salaries')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalariesController {
  constructor(private readonly salariesService: SalariesService) {}

  @Post()
  // ✅ استخدام الثابت مباشرة كـ PermissionMetadata
  @Permissions(PERMS.SALARY_MANAGE)
  create(@Body() dto: CreateSalaryDto, @CurrentTenantId() tenantId: string) {
    return this.salariesService.create(dto, tenantId);
  }

  @Get()
  @Permissions(PERMS.SALARY_VIEW)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.salariesService.findAll(tenantId);
  }

  @Patch(':id')
  @Permissions(PERMS.SALARY_MANAGE)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSalaryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    // ✅ تم إصلاح الخطأ المطبعي هنا
    return this.salariesService.update(id, dto, tenantId);
  }
}
