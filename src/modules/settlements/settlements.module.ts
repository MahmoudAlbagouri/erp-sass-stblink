// src/modules/settlements/settlements.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Settlement } from './entities/settlement.entity';
import { SettlementsService } from './settlements.service';
import { SettlementsController } from './settlements.controller';

// ✅ استيراد كيانات إضافية مطلوبة للخدمة الجديدة
import { LeaveBalance } from '../leaves/entities/leave-balance.entity';
import { LeaveBalanceHistory } from '../leaves/entities/leave-balance-history.entity'; // ✅ كيان سجل الحركات

// ✅ استيراد الموديولات الخارجية للوصول لخدماتها
import { SalariesModule } from '../salaries/salaries.module';
import { ContractsModule } from '../contracts/contracts.module'; // ✅ لجلب بيانات العقد
import { LeavesModule } from '../leaves/leaves.module'; // ✅ لاستخدام LeaveAccrualService
import { CommonModule } from 'src/common/common.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Settlement,
      LeaveBalance,
      LeaveBalanceHistory, // ✅ تسجيل الكيان الجديد في TypeORM
    ]),
    SalariesModule,
    ContractsModule,
    LeavesModule, // ✅ لاستحقاق الوصول إلى LeaveAccrualService المُصدَّرة منه
    CommonModule,
    SubscriptionsModule, // استيراد موديول الاشتراكات
  ],
  controllers: [SettlementsController],
  providers: [SettlementsService],
  exports: [SettlementsService],
})
export class SettlementsModule {}
