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
import { EOSService } from './eos.service';
import { CreateEOSDto } from './dto/create-eos.dto';
import { UpdateEOSDto } from './dto/update-eos.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { PERMS } from '../../common/constants/permissions';

@Controller('eos')
@UseGuards(JwtAuthGuard)
export class EOSController {
  constructor(private readonly eosService: EOSService) {}

  @Post()
  @Permissions(PERMS.EOS_CREATE)
  @UseGuards(PermissionsGuard)
  create(@Body() dto: CreateEOSDto, @CurrentTenantId() tenantId: string) {
    return this.eosService.create(dto, tenantId);
  }

  @Get()
  @Permissions(PERMS.EOS_VIEW)
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.eosService.findAll(tenantId);
  }

  @Get(':id')
  @Permissions(PERMS.EOS_VIEW)
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.eosService.findOne(id, tenantId);
  }

  @Patch(':id')
  @Permissions(PERMS.EOS_UPDATE)
  @UseGuards(PermissionsGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEOSDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.eosService.update(id, dto, tenantId);
  }

  @Delete(':id')
  @Permissions(PERMS.EOS_DELETE)
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.eosService.remove(id, tenantId);
  }
}
