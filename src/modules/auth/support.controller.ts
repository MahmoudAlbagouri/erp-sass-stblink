// src/modules/auth/support.controller.ts
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SystemAdmin } from '../../common/decorators/system-admin.decorator';
import { SystemAdminGuard } from '../../common/guards/system-admin.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { SupportService } from './support.service';

/** وضع الدعم — لمالك النظام فقط */
@Controller('auth/support')
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@SystemAdmin()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  /** سجل جلسات الدعم الأخيرة */
  @Get('sessions')
  findRecent() {
    return this.support.findRecent();
  }

  /** الدخول إلى شركة (أو تجديد الجلسة الجارية فيها) */
  @Post(':tenantId')
  @HttpCode(HttpStatus.OK)
  enter(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @CurrentUser('id') ownerId: string,
  ) {
    return this.support.enter(ownerId, tenantId);
  }
}
