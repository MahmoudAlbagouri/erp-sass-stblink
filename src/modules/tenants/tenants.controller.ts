// src/modules/tenants/tenants.controller.ts
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
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
// import { RegisterTenantDto } from './dto/register-tenant.dto';

@Controller('tenants')
@UseGuards(JwtAuthGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  // @Post('register')
  // async register(@Body() dto: RegisterTenantDto) {
  //   const result = await this.tenantsService.register(dto);

  //   return {
  //     message: 'تم إنشاء الشركة والمدير بنجاح',
  //     tenantId: result.tenant.id,
  //     adminId: result.admin.id,
  //     adminEmail: result.admin.email,
  //     // accessToken: token, // سيتم تفعيله عند إضافة الـ Auth
  //   };
  // }

  @Post()
  create(@Body() createTenantDto: CreateTenantDto) {
    return this.tenantsService.create(createTenantDto);
  }

  @Get()
  findAll() {
    return this.tenantsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tenantsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateTenantDto: UpdateTenantDto) {
    return this.tenantsService.update(id, updateTenantDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.tenantsService.remove(id);
    return { message: 'تم حذف الشركة وجميع بياناتها المرتبطة بنجاح' };
  }
}
