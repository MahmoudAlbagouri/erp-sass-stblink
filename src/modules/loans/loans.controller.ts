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
// ✅ استيراد الثوابت
import { PERMS } from 'src/common/constants/permissions';

@Controller('loans')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Post('my-loans')
  // ✅ استخدام ثابت الخدمة الذاتية للقروض
  @Permissions(PERMS.LOAN_REQUEST_SELF)
  createMyLoan(
    @CurrentUser() user: CurrentUserData,
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateLoanDto,
  ) {
    if (!user.employeeId) {
      throw new NotFoundException(
        'حسابك غير مرتبط بملف موظف، لا يمكنك طلب قرض',
      );
    }
    return this.loansService.create(dto, user.employeeId, tenantId);
  }

  @Get()
  @Permissions(PERMS.LOAN_VIEW)
  findAll(@CurrentTenantId() tenantId: string) {
    return this.loansService.findAll(tenantId);
  }

  @Patch(':id/status')
  @Permissions(PERMS.LOAN_APPROVE)
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: LoanStatus,
    @CurrentTenantId() tenantId: string,
  ) {
    return this.loansService.updateStatus(id, status, tenantId);
  }
}
