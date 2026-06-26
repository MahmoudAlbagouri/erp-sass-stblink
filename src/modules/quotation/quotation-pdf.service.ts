// src/quotations/quotation-pdf.service.ts
import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises'; // ✅ استخدام promises للتعامل مع async/await
import { existsSync } from 'fs';
import * as path from 'path';
import * as handlebars from 'handlebars';
import * as puppeteer from 'puppeteer';

@Injectable()
export class QuotationPdfService {
  // ✅ دالة مساعدة غير متزامنة لقراءة الصور
  private async getImageBase64(filePath: string): Promise<string> {
    try {
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase().replace('.', '');
      const mimeType = ext === 'svg' ? 'svg+xml' : ext;
      return `data:image/${mimeType};base64,${buffer.toString('base64')}`;
    } catch (error) {
      console.error(`Error reading image at ${filePath}:`, error);
      return '';
    }
  }

  // ✅ دالة تحميل الأصول باستخدام async/await
  private async loadAssets(): Promise<{ logo: string; companyImage: string }> {
    const logoPath = path.join(process.cwd(), 'assets', 'logo.png');
    const companyImagePath = path.join(process.cwd(), 'assets', 'company.png');

    const [logo, companyImage] = await Promise.all([
      this.getImageBase64(logoPath),
      this.getImageBase64(companyImagePath),
    ]);

    return { logo, companyImage };
  }

  async generatePdf(data: any): Promise<Buffer> {
    const templatePath = path.join(
      process.cwd(),
      'src',
      'templates',
      'quotation.hbs',
    );

    if (!existsSync(templatePath)) {
      throw new Error('Quotation template not found');
    }

    const templateSource = await fs.readFile(templatePath, 'utf-8');
    const assets = await this.loadAssets(); // ✅ انتظار تحميل الصور

    const compiledTemplate = handlebars.compile(templateSource);
    const html = compiledTemplate({ ...data, ...assets });

    return this.renderToPdf(html);
  }

  async generateInvoicePdf(data: any): Promise<Buffer> {
    const templatePath = path.join(
      process.cwd(),
      'src',
      'templates',
      'invoice.hbs',
    );

    if (!existsSync(templatePath)) {
      throw new Error('Invoice template not found');
    }

    const templateSource = await fs.readFile(templatePath, 'utf-8');
    const assets = await this.loadAssets(); // ✅ انتظار تحميل الصور

    const compiledTemplate = handlebars.compile(templateSource);
    const html = compiledTemplate({ ...data, ...assets });

    return this.renderToPdf(html);
  }

  private async renderToPdf(html: string): Promise<Buffer> {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    try {
      const page = await browser.newPage();

      // ✅ استخدام networkidle0 لضمان معالجة الـ Base64 بالكامل
      await page.setContent(html, {
        waitUntil: 'load',
        timeout: 30000,
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' },
        preferCSSPageSize: true,
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }
}
