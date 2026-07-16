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
import { BonusesService } from './bonuses.service';
import { CreateBonusDto } from './dto/create-bonus.dto';
import { UpdateBonusDto } from './dto/update-bonus.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { PERMS } from '../../common/constants/permissions';

@Controller('bonuses')
@UseGuards(JwtAuthGuard)
export class BonusesController {
  constructor(private readonly bonusesService: BonusesService) {}

  @Post()
  @Permissions(PERMS.BONUS_CREATE)
  @UseGuards(PermissionsGuard)
  create(@Body() dto: CreateBonusDto, @CurrentTenantId() tenantId: string) {
    return this.bonusesService.create(dto, tenantId);
  }

  @Get()
  @Permissions(PERMS.BONUS_VIEW)
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.bonusesService.findAll(tenantId);
  }

  @Get(':id')
  @Permissions(PERMS.BONUS_VIEW)
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.bonusesService.findOne(id, tenantId);
  }

  @Patch(':id')
  @Permissions(PERMS.BONUS_UPDATE)
  @UseGuards(PermissionsGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBonusDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.bonusesService.update(id, dto, tenantId);
  }

  @Delete(':id')
  @Permissions(PERMS.BONUS_DELETE)
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
    return this.bonusesService.remove(id, tenantId);
  }
}
