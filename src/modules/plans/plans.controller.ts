import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { PlansService } from './plans.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PERMS } from '../../common/constants/permissions';
import { FEATURES } from '../../common/constants/features';

@Controller('plans')
@UseGuards(JwtAuthGuard)
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Get('features/list')
  @Permissions(PERMS.PLAN_VIEW)
  @UseGuards(PermissionsGuard)
  listAvailableFeatures() {
    return Object.values(FEATURES);
  }

  @Post()
  @Permissions(PERMS.PLAN_CREATE)
  @UseGuards(PermissionsGuard)
  create(@Body() dto: CreatePlanDto) {
    return this.plansService.create(dto);
  }

  @Get()
  @Permissions(PERMS.PLAN_VIEW)
  @UseGuards(PermissionsGuard)
  findAll(@Query('includeInactive') includeInactive?: string) {
    return this.plansService.findAll(includeInactive === 'true');
  }

  @Get(':id')
  @Permissions(PERMS.PLAN_VIEW)
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string) {
    return this.plansService.findOne(id);
  }

  @Patch(':id')
  @Permissions(PERMS.PLAN_UPDATE)
  @UseGuards(PermissionsGuard)
  update(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.plansService.update(id, dto);
  }

  @Delete(':id')
  @Permissions(PERMS.PLAN_DELETE)
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string) {
    return this.plansService.remove(id);
  }
}
