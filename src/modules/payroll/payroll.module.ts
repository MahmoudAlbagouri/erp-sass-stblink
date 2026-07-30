// src/modules/payroll/payroll.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payroll } from './entities/payroll.entity';
import { PayrollItem } from './entities/payroll-item.entity';
import { PayrollService } from './payroll.service';
import { PayrollController } from './payroll.controller';
import { ReportService } from '../../common/reports/report.service';
import { Salary } from '../salaries/entities/salary.entity';
import { Loan } from '../loans/entities/loan.entity';
import { Advance } from '../advances/entities/advance.entity';
import { LeaveRequest } from '../leaves/entities/leave-request.entity';
import { Employee } from '../employees/entities/employee.entity';
import { SalariesModule } from '../salaries/salaries.module'; // ✅ استيراد الموديول
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    // 1. تسجيل الجداول (Entities) فقط هنا
    TypeOrmModule.forFeature([
      Payroll,
      PayrollItem,
      Salary,
      Loan,
      Advance,
      LeaveRequest,
      Employee,
    ]),

    // 2. استيراد الموديولات الخارجية هنا (خارج forFeature)
    SalariesModule,
    SubscriptionsModule, // استيراد موديول الاشتراكات
  ],
  controllers: [PayrollController],
  providers: [PayrollService, ReportService],
  exports: [PayrollService],
})
export class PayrollModule {}
