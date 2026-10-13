// src/modules/dashboard/dashboard.module.ts
import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** أرقام الصفحة الرئيسية: قراءة فقط، مجمّعة من موديولات الشركة */
@Module({
  imports: [
    SubscriptionsModule, // SubscriptionManagerService: ما تشمله الخطة
    InventoryModule, // StockService.summary
    AttendanceModule, // AttendanceService.getDailySummary
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
