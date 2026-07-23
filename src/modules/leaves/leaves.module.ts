// src/modules/leaves/leaves.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LeavesService } from './leaves.service';
import { LeavesController } from './leaves.controller';
import { LeaveAccrualService } from './leave-accrual.service';
import { LeaveCarryoverCronService } from './leave-carryover.cron.service';

// ✅ استيراد DateUtils إذا كانت في موديول منفصل

import { LeaveRequest } from './entities/leave-request.entity';
import { LeaveBalance } from './entities/leave-balance.entity';
import { LeaveBalanceHistory } from './entities/leave-balance-history.entity';

import { ContractsModule } from '../contracts/contracts.module';
import { DateUtils } from 'src/common/utils/date.utils';
import { LeavePolicyService } from './config/leave-policy.config';
import { ReportService } from 'src/common/reports/report.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([LeaveRequest, LeaveBalance, LeaveBalanceHistory]),
    ContractsModule,
  ],
  controllers: [LeavesController],
  providers: [
    LeavesService,
    LeaveAccrualService,
    LeaveCarryoverCronService,
    DateUtils, // ✅ إضافة الموديول الذي يحتوي على DateUtils
    LeavePolicyService,
    ReportService,
  ],
  exports: [LeavesService, DateUtils, LeaveAccrualService],
})
export class LeavesModule {}
