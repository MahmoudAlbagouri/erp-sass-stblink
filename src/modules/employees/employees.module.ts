// src/modules/employees/employees.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Employee } from './entities/employee.entity';
import { User } from '../users/entities/user.entity';
import { EmployeesService } from './employees.service';
import { EmployeesController } from './employees.controller';
import { ReportService } from '../../common/reports/report.service'; // أضف هذا الاستيراد

@Module({
  imports: [TypeOrmModule.forFeature([Employee, User])],
  controllers: [EmployeesController],
  providers: [EmployeesService, ReportService], // أضف ReportService هنا
  exports: [EmployeesService],
})
export class EmployeesModule {}
