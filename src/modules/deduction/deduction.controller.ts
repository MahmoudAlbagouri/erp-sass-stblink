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
import { DeductionsService } from './deduction.service';
import { CreateDeductionDto } from './dto/create-deduction.dto';
import { UpdateDeductionDto } from './dto/update-deduction.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { PERMS } from '../../common/constants/permissions';

@Controller('deductions')
@UseGuards(JwtAuthGuard)
export class DeductionsController {
  constructor(private readonly deductionsService: DeductionsService) {}

  @Post()
  @Permissions(PERMS.DEDUCTION_CREATE)
  @UseGuards(PermissionsGuard)
  create(@Body() dto: CreateDeductionDto, @CurrentTenantId() tenantId: string) {
    return this.deductionsService.create(dto, tenantId);
  }

  @Get()
  @Permissions(PERMS.DEDUCTION_VIEW)
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.deductionsService.findAll(tenantId);
  }

  @Get(':id')
  @Permissions(PERMS.DEDUCTION_VIEW)
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.deductionsService.findOne(id, tenantId);
  }

  @Patch(':id')
  @Permissions(PERMS.DEDUCTION_UPDATE)
  @UseGuards(PermissionsGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDeductionDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.deductionsService.update(id, dto, tenantId);
  }

  @Delete(':id')
  @Permissions(PERMS.DEDUCTION_DELETE)
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.deductionsService.remove(id, tenantId);
  }
}
