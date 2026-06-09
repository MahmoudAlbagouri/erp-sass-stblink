// src/modules/employees/employees.controller.ts
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
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';

@Controller('employees')
@UseGuards(JwtAuthGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  @Permissions('create_employee')
  @UseGuards(PermissionsGuard)
  create(@Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(dto);
  }

  @Get()
  @Permissions('view_employees')
  @UseGuards(PermissionsGuard)
  findAll() {
    return this.employeesService.findAll();
  }

  @Get(':id')
  @Permissions('view_employees')
  @UseGuards(PermissionsGuard)
  findOne(@Param('id') id: string) {
    return this.employeesService.findOne(id);
  }

  @Patch(':id')
  @Permissions('update_employee')
  @UseGuards(PermissionsGuard)
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employeesService.update(id, dto);
  }

  @Delete(':id')
  @Permissions('delete_employee')
  @UseGuards(PermissionsGuard)
  remove(@Param('id') id: string) {
    return this.employeesService.remove(id);
  }
}
