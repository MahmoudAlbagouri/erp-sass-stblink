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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Payroll,
      PayrollItem,
      Salary,
      Loan,
      Advance,
      LeaveRequest,
      Employee,
    ]),
  ],
  controllers: [PayrollController],
  providers: [PayrollService, ReportService],
  exports: [PayrollService],
})
export class PayrollModule {}
