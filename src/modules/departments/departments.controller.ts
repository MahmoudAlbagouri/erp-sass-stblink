import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { PERMS } from 'src/common/constants/permissions';

@Controller('departments')
@UseGuards(JwtAuthGuard)
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Post()
  @Permissions(PERMS.DEPARTMENT_CREATE)
  @UseGuards(PermissionsGuard)
  create(
    @Body() dto: CreateDepartmentDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.departmentsService.create(dto, tenantId);
  }

  @Get()
  @Permissions(PERMS.DEPARTMENT_VIEW)
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.departmentsService.findAll(tenantId);
  }

  // ✅ لازم تكون قبل ':id' حتى لا يعتبرها Nest بارامتر id
  @Get('stats')
  @Permissions(PERMS.DEPARTMENT_VIEW)
  @UseGuards(PermissionsGuard)
  findAllWithCounts(@CurrentTenantId() tenantId: string) {
    return this.departmentsService.findAllWithCounts(tenantId);
  }

  @Patch(':id')
  @Permissions(PERMS.DEPARTMENT_UPDATE)
  @UseGuards(PermissionsGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.departmentsService.update(id, dto, tenantId);
  }

  @Delete(':id')
  @Permissions(PERMS.DEPARTMENT_DELETE)
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.departmentsService.remove(id, tenantId);
  }
}
