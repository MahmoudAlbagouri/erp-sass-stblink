// src/modules/settlements/settlements.controller.ts

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { SettlementsService } from './settlements.service';
import { ConfirmSettlementDto } from './dto/confirm-settlement.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';
import { PERMS } from 'src/common/constants/permissions';

@Controller('settlements')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  /**
   * POST /settlements/calculate/:employeeId
   * يعرض حساب المستحقات للمراجعة قبل التأكيد (لا يُحفظ شيء)
   */
  @Post('calculate/:employeeId')
  @Permissions(PERMS.SETTLEMENT_VIEW)
  calculate(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settlementsService.calculateSettlement(employeeId, tenantId);
  }

  /**
   * POST /settlements/confirm
   * يؤكد التسوية ويحفظها في قاعدة البيانات ويُصفّر رصيد الإجازات
   */
  @Post('confirm')
  @Permissions(PERMS.SETTLEMENT_CREATE)
  confirm(
    @Body() dto: ConfirmSettlementDto,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settlementsService.confirmSettlement(dto, tenantId);
  }

  /**
   * GET /settlements
   * جلب كل التسويات المؤرشفة
   */
  @Get()
  @Permissions(PERMS.SETTLEMENT_VIEW)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.settlementsService.findAll(tenantId);
  }

  /**
   * GET /settlements/employee/:employeeId
   * جلب تسوية موظف محدد
   */
  @Get('employee/:employeeId')
  @Permissions(PERMS.SETTLEMENT_VIEW)
  findByEmployee(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.settlementsService.findByEmployee(employeeId, tenantId);
  }
}
