// src/modules/salaries/salaries.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalariesService } from './salaries.service';
import { SalariesController } from './salaries.controller';
import { Salary } from './entities/salary.entity';
import { ReportService } from 'src/common/reports/report.service';

@Module({
  // تسجيل الـ Entity في TypeOrm لإنشاء الجدول في قاعدة البيانات
  imports: [TypeOrmModule.forFeature([Salary])],
  controllers: [SalariesController],
  providers: [SalariesService, ReportService],
  // تصدير الخدمة إذا كنت ستحتاج لاستخدامها في موديولات أخرى مستقبلاً (مثل PayrollModule)
  exports: [SalariesService],
})
export class SalariesModule {}
