import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Deduction } from './entities/deduction.entity';
import { Employee } from '../employees/entities/employee.entity';
import { DeductionsService } from './deduction.service';
import { DeductionsController } from './deduction.controller';
import { ReportService } from 'src/common/reports/report.service';

@Module({
  imports: [TypeOrmModule.forFeature([Deduction, Employee])],
  controllers: [DeductionsController],
  providers: [DeductionsService, ReportService],
  exports: [DeductionsService], // ✅ مهم لاستخدامه داخل PayrollModule
})
export class DeductionsModule {}
