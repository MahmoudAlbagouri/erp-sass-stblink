// src/quotations/quotation.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuotationController } from './quotation.controller';
import { QuotationService } from './quotation.service';
import { Quotation } from './entities/quotation.entity';
import { QuotationPdfService } from './quotation-pdf.service';

@Module({
  imports: [TypeOrmModule.forFeature([Quotation])],
  controllers: [QuotationController],
  providers: [QuotationService, QuotationPdfService], // ✅ تم التسجيل هنا
  exports: [QuotationService],
})
export class QuotationModule {}
