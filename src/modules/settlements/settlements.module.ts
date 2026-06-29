// src/modules/settlements/settlements.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Settlement } from './entities/settlement.entity';
import { SettlementsService } from './settlements.service';
import { SettlementsController } from './settlements.controller';

// الكيانات الخارجية المطلوبة
import { LeaveBalance } from '../leaves/entities/leave-balance.entity';
import { SalariesModule } from '../salaries/salaries.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Settlement, LeaveBalance]),
    SalariesModule, // نستورد الموديول كاملاً لأن SalariesService مُصدَّر منه
  ],
  controllers: [SettlementsController],
  providers: [SettlementsService],
  exports: [SettlementsService],
})
export class SettlementsModule {}
