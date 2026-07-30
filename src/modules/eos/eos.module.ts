// src/modules/eos/eos.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EndOfService } from './entities/eos.entity';
import { Employee } from '../employees/entities/employee.entity';
import { EOSService } from './eos.service';
import { EOSController } from './eos.controller';
import { ContractsModule } from '../contracts/contracts.module';
import { SalariesModule } from '../salaries/salaries.module';
import { DateUtils } from '../../common/utils/date.utils'; // ✅ تأكد من صحة المسار حسب مشروعك
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EndOfService, Employee]),
    ContractsModule,
    SalariesModule,
    SubscriptionsModule, // استيراد موديول الاشتراكات
  ],
  controllers: [EOSController],
  providers: [
    EOSService,
    DateUtils, // ✅ تم تسجيل DateUtils هنا لحل مشكلة الاعتمادية
  ],
  exports: [EOSService],
})
export class EOSModule {}
