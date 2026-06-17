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
import { ShiftsService } from './shifts.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { CurrentTenantId } from 'src/common/decorators/current-tenant-id.decorator';
import { UpdateShiftDto } from './dto/update-shift.dto';

@Controller('shifts')
@UseGuards(JwtAuthGuard)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post()
  create(@Body() dto: CreateShiftDto, @CurrentTenantId() tenantId: string) {
    return this.shiftsService.create(dto, tenantId);
  }

  @Get()
  findAll(@CurrentTenantId() tenantId: string) {
    return this.shiftsService.findAll(tenantId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateShiftDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.shiftsService.update(id, dto, tenantId);
  }
}
