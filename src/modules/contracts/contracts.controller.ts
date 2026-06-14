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
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';

@Controller('contracts')
@UseGuards(JwtAuthGuard, PermissionsGuard) // تفعيل الحماية على مستوى الـ Controller
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post()
  @Permissions('create_contract')
  create(@Body() dto: CreateContractDto, @CurrentTenantId() tenantId: string) {
    return this.contractsService.create(dto, tenantId);
  }

  @Get()
  @Permissions('view_contracts')
  findAll(@CurrentTenantId() tenantId: string) {
    return this.contractsService.findAll(tenantId);
  }

  @Get(':id')
  @Permissions('view_contracts')
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.contractsService.findOne(id, tenantId);
  }

  @Patch(':id')
  @Permissions('update_contract')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateContractDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.contractsService.update(id, dto, tenantId);
  }

  @Delete(':id')
  @Permissions('delete_contract')
  remove(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.contractsService.remove(id, tenantId);
  }
}
