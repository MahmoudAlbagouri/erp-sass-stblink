// src/quotations/quotation.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { apiTag } from '../../config/swagger.config';
import type { Response } from 'express';
import { QuotationService } from './quotation.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PERMS } from '../../common/constants/permissions';

@ApiTags(apiTag('QUOTATIONS'))
@Controller('quotations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class QuotationController {
  constructor(private readonly quotationService: QuotationService) {}

  /** إنشاء عرض سعر */
  @Post()
  @Permissions(PERMS.QUOTATION_CREATE)
  create(@Body() createDto: CreateQuotationDto) {
    return this.quotationService.create(createDto);
  }

  /** قائمة عروض الأسعار */
  @Get()
  @Permissions(PERMS.QUOTATION_VIEW)
  findAll() {
    return this.quotationService.findAll();
  }

  /** عرض سعر واحد */
  @Get(':id')
  @Permissions(PERMS.QUOTATION_VIEW)
  findOne(@Param('id') id: string) {
    return this.quotationService.findOne(id);
  }

  /** تعديل عرض سعر */
  @Patch(':id')
  @Permissions(PERMS.QUOTATION_UPDATE)
  update(@Param('id') id: string, @Body() updateDto: UpdateQuotationDto) {
    return this.quotationService.update(id, updateDto);
  }

  /** حذف عرض سعر */
  @Delete(':id')
  @Permissions(PERMS.QUOTATION_DELETE)
  remove(@Param('id') id: string) {
    return this.quotationService.remove(id);
  }

  // ✅ تصدير عرض السعر كـ PDF
  /** تصدير عرض السعر PDF */
  @Get(':id/pdf')
  @Permissions(PERMS.QUOTATION_EXPORT_PDF)
  async exportPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.quotationService.generatePdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=quotation-${id}.pdf`,
    );
    res.send(buffer);
  }

  // ✅ الموافقة وتحويل العرض لفاتورة
  /** اعتماد عرض سعر */
  @Patch(':id/approve')
  @Permissions(PERMS.QUOTATION_APPROVE)
  approve(@Param('id') id: string) {
    return this.quotationService.approveAndConvertToInvoice(id);
  }

  // ✅ تصدير الفاتورة كـ PDF
  /** تصدير فاتورة عرض السعر المعتمد PDF */
  @Get(':id/invoice-pdf')
  @Permissions(PERMS.QUOTATION_EXPORT_PDF)
  async exportInvoicePdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.quotationService.generateInvoicePdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=invoice-${id}.pdf`,
    );
    res.send(buffer);
  }
}
