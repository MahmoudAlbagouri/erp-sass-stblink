import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractsService } from './contracts.service';
import { ContractsController } from './contracts.controller';
import { Contract } from './entities/contract.entity';
import { ReportService } from '../../common/reports/report.service'; // أضف هذا الاستيراد
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [TypeOrmModule.forFeature([Contract]), SubscriptionsModule],
  controllers: [ContractsController],
  providers: [ContractsService, ReportService],
  exports: [ContractsService], // مهم لتستخدمه في الـ AttendanceService لاحقاً
})
export class ContractsModule {}
