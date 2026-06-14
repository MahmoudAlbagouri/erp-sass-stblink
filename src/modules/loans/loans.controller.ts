// src/modules/loans/loans.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { LoanStatus } from './entities/loan.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import {
  CurrentUser,
  type CurrentUserData,
} from '../../common/decorators/current-user.decorator';
import { CurrentTenantId } from '../../common/decorators/current-tenant-id.decorator';

@Controller('loans')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LoansController {
  constructor(private readonly loansService: LoansService) {}
  @Post('my-loans')
  createMyLoan(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateLoanDto,
  ) {
    // التحقق من وجود ملف موظف مرتبط بالمستخدم
    if (!user.employeeId) {
      throw new NotFoundException(
        'حسابك غير مرتبط بملف موظف، لا يمكنك طلب قرض',
      );
    }

    // الآن TypeScript يعرف أن user.employeeId هو string بالتأكيد
    return this.loansService.create(dto, user.employeeId, tenantId);
  }

  @Get()
  @Permissions('view_loans')
  findAll(@CurrentTenantId() tenantId: string) {
    return this.loansService.findAll(tenantId);
  }

  @Patch(':id/status')
  @Permissions('approve_loan')
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: LoanStatus,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.loansService.updateStatus(id, status, tenantId);
  }
}
