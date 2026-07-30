// src/modules/advances/advances.module.ts
import { Module } from '@nestjs/common';
import { AdvancesService } from './advances.service';
import { AdvancesController } from './advances.controller';
import { Advance } from './entities/advance.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalariesModule } from '../salaries/salaries.module'; // استيراد موديول الرواتب
import { ReportService } from 'src/common/reports/report.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Advance]),
    SalariesModule, // مهم للوصول لـ SalariesService
    SubscriptionsModule, // استيراد موديول الاشتراكات
  ],
  controllers: [AdvancesController],
  providers: [AdvancesService, ReportService], // إضافة ReportService إذا كنت بحاجة لتوليد تقارير
  exports: [AdvancesService],
})
export class AdvancesModule {}
