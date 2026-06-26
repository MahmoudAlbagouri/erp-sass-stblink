// src/quotations/quotation.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { Quotation } from './entities/quotation.entity';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { QuotationPdfService } from './quotation-pdf.service';

@Injectable()
export class QuotationService {
  constructor(
    @InjectRepository(Quotation)
    private readonly quotationRepository: Repository<Quotation>,
    private readonly pdfService: QuotationPdfService,
  ) {}

  async create(dto: CreateQuotationDto): Promise<Quotation> {
    let subTotal = 0;
    const items = dto.items.map((item) => {
      const total = item.qty * item.unitPrice;
      subTotal += total;
      return { ...item, total };
    });

    const taxAmount = subTotal * 0.15;
    const grandTotal = subTotal + taxAmount;

    // ✅ حساب العدد الكلي بدون فلتر tenantId
    const count = await this.quotationRepository.count();
    const quotationNumber = `QP-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`;

    const quotation = this.quotationRepository.create({
      ...dto,
      items,
      subTotal,
      taxAmount,
      grandTotal,
      quotationNumber,
      bankAccounts: dto.bankAccounts || [],
      termsAndConditions: dto.termsAndConditions || [],
    });

    return this.quotationRepository.save(quotation);
  }

  async findAll(): Promise<Quotation[]> {
    return this.quotationRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Quotation> {
    // ✅ بحث عام بدون فلتر tenantId
    const quotation = await this.quotationRepository.findOne({
      where: { id },
    });
    if (!quotation) throw new NotFoundException('Quotation not found');
    return quotation;
  }

  async update(id: string, dto: UpdateQuotationDto): Promise<Quotation> {
    const quotation = await this.findOne(id);

    if (dto.items) {
      let subTotal = 0;
      const items = dto.items.map((item) => {
        const total = item.qty * item.unitPrice;
        subTotal += total;
        return { ...item, total };
      });

      Object.assign(quotation, {
        items,
        subTotal,
        taxAmount: subTotal * 0.15,
        grandTotal: subTotal * 1.15,
      });
    }

    if (dto.bankAccounts !== undefined)
      quotation.bankAccounts = dto.bankAccounts;
    if (dto.termsAndConditions !== undefined)
      quotation.termsAndConditions = dto.termsAndConditions;

    Object.assign(quotation, dto);
    return this.quotationRepository.save(quotation);
  }

  async remove(id: string): Promise<void> {
    const quotation = await this.findOne(id);
    await this.quotationRepository.remove(quotation);
  }

  // ✅ الموافقة وتحويل العرض لفاتورة
  async approveAndConvertToInvoice(id: string): Promise<Quotation> {
    const quotation = await this.findOne(id);

    if (quotation.status === 'approved') {
      throw new BadRequestException('هذا العرض تم تحويله لفاتورة بالفعل');
    }

    // ✅ حساب عدد الفواتير الكلي في النظام
    const invoiceCount = await this.quotationRepository.count({
      where: { invoiceNumber: Not(IsNull()) },
    });

    quotation.status = 'approved';
    quotation.invoiceNumber = `INV-${new Date().getFullYear()}-${String(invoiceCount + 1).padStart(4, '0')}`;

    return this.quotationRepository.save(quotation);
  }

  // ✅ توليد PDF لعرض السعر
  async generatePdf(id: string): Promise<Buffer> {
    const quotation = await this.findOne(id);

    const pdfData = {
      quotationNumber: quotation.quotationNumber,
      date: new Date().toLocaleDateString('ar-SA'),
      customerName: quotation.customerName,
      customerPhone: quotation.customerPhone || '-',
      customerAddress: quotation.customerAddress || '-',
      items: quotation.items,
      subTotal: Number(quotation.subTotal).toLocaleString('en-US', {
        minimumFractionDigits: 2,
      }),
      taxAmount: Number(quotation.taxAmount).toLocaleString('en-US', {
        minimumFractionDigits: 2,
      }),
      grandTotal: Number(quotation.grandTotal).toLocaleString('en-US', {
        minimumFractionDigits: 2,
      }),
      notes: quotation.notes || '',
      bankAccounts: quotation.bankAccounts,
      termsAndConditions: quotation.termsAndConditions,
    };

    return this.pdfService.generatePdf(pdfData);
  }

  // ✅ توليد PDF للفاتورة
  async generateInvoicePdf(id: string): Promise<Buffer> {
    const quotation = await this.findOne(id);

    if (!quotation.invoiceNumber) {
      throw new BadRequestException(
        'يجب الموافقة على عرض السعر أولاً لتوليد الفاتورة',
      );
    }

    const pdfData = {
      invoiceNumber: quotation.invoiceNumber,
      quotationNumber: quotation.quotationNumber,
      date: new Date().toLocaleDateString('ar-SA'),
      customerName: quotation.customerName,
      customerPhone: quotation.customerPhone || '-',
      customerAddress: quotation.customerAddress || '-',
      items: quotation.items,
      subTotal: Number(quotation.subTotal).toLocaleString('en-US', {
        minimumFractionDigits: 2,
      }),
      taxAmount: Number(quotation.taxAmount).toLocaleString('en-US', {
        minimumFractionDigits: 2,
      }),
      grandTotal: Number(quotation.grandTotal).toLocaleString('en-US', {
        minimumFractionDigits: 2,
      }),
      bankAccounts: quotation.bankAccounts,
    };

    return this.pdfService.generateInvoicePdf(pdfData);
  }
}
