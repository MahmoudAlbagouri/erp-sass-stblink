// src/modules/leaves/leaves.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LeavesService } from './leaves.service';
import { LeavesController } from './leaves.controller';
import { LeaveRequest } from './entities/leave-request.entity';
import { LeaveBalance } from './entities/leave-balance.entity';
import { ContractsModule } from '../contracts/contracts.module'; // ✅ استيراد موديول العقود

@Module({
  imports: [
    TypeOrmModule.forFeature([LeaveRequest, LeaveBalance]),
    ContractsModule, // ✅ تمكين الوصول لخدمة العقود
  ],
  controllers: [LeavesController],
  providers: [LeavesService],
  exports: [LeavesService],
})
export class LeavesModule {}
