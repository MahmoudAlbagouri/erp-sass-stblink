import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Employee } from './entities/employee.entity';
import { User } from '../users/entities/user.entity';
import { Role } from '../roles/entities/role.entity';
import { Permission } from '../permissions/entities/permission.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { Salary } from '../salaries/entities/salary.entity';
import { Department } from '../departments/entities/department.entity';

import { EmployeesService } from './employees.service';
import { EmployeesOnboardingService } from './employees-onboarding.service';
import { EmployeesController } from './employees.controller';
import { ReportService } from '../../common/reports/report.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { EmployeesQuotaResolver } from './employees-quota.resolver';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Employee,
      User,
      Role,
      Permission,
      Contract,
      Salary,
      Department, // ✅
    ]),
    SubscriptionsModule,
    NotificationsModule,
  ],
  controllers: [EmployeesController],
  providers: [
    EmployeesService,
    EmployeesOnboardingService,
    ReportService,
    EmployeesQuotaResolver,
  ],
  exports: [EmployeesService, EmployeesOnboardingService],
})
export class EmployeesModule {}
