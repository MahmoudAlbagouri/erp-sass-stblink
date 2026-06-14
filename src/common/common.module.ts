// src/common/common.module.ts
import { Module } from '@nestjs/common';
import { ReportService } from './reports/report.service';

@Module({
  providers: [ReportService],
  exports: [ReportService], // ← هذه أهم خطوة
})
export class CommonModule {}
