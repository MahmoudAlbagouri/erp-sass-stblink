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

@Controller('salaries')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalariesController {
  constructor(private readonly salariesService: SalariesService) {}

  @Post()
  @Permissions('manage_salary')
  create(@Body() dto: CreateSalaryDto, @CurrentTenantId() tenantId: string) {
    return this.salariesService.create(dto, tenantId);
  }

  @Get()
  @Permissions('view_salaries')
  findAll(@CurrentTenantId() tenantId: string) {
    return this.salariesService.findAll(tenantId);
  }

  @Patch(':id')
  @Permissions('manage_salary')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSalaryDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.salariesService.update(id, dto, tenantId);
  }
}
