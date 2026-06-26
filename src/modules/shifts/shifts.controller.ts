// src/modules/shifts/shifts.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ShiftsService } from './shifts.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { CurrentTenantId } from 'src/common/decorators/current-tenant-id.decorator';
// ✅ استيراد الثوابت
import { PERMS } from 'src/common/constants/permissions';

@Controller('shifts')
@UseGuards(JwtAuthGuard)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post()
  @Permissions(PERMS.SHIFT_CREATE)
  @UseGuards(PermissionsGuard)
  create(@Body() dto: CreateShiftDto, @CurrentTenantId() tenantId: string) {
    return this.shiftsService.create(dto, tenantId);
  }

  @Get()
  @Permissions(PERMS.SHIFT_VIEW)
  @UseGuards(PermissionsGuard)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.shiftsService.findAll(tenantId);
  }

  @Patch(':id')
  @Permissions(PERMS.SHIFT_UPDATE)
  @UseGuards(PermissionsGuard)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateShiftDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.shiftsService.update(id, dto, tenantId);
  }
}
