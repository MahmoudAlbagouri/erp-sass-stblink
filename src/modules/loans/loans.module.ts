// src/modules/loans/loans.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { Loan } from './entities/loan.entity';
import { ReportService } from 'src/common/reports/report.service';

@Module({
  imports: [TypeOrmModule.forFeature([Loan])],
  controllers: [LoansController],
  providers: [LoansService, ReportService], // إضافة ReportService إذا كنت بحاجة لتوليد تقارير
  exports: [LoansService],
})
export class LoansModule {}
