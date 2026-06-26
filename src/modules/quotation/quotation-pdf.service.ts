// src/modules/quotation/quotation-pdf.service.ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import * as handlebars from 'handlebars';
import * as puppeteer from 'puppeteer';

@Injectable()
export class QuotationPdfService {
  private async getImageBase64(filePath: string): Promise<string> {
    try {
      if (!existsSync(filePath)) return '';
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase().replace('.', '');
      const mimeType = ext === 'svg' ? 'svg+xml' : ext;
      return `data:image/${mimeType};base64,${buffer.toString('base64')}`;
    } catch {
      return '';
    }
  }

  private async loadAssets(): Promise<{ logo: string; companyImage: string }> {
    const rootDir = process.cwd();
    const logoPath = path.join(rootDir, 'assets', 'logo.png');
    const companyImagePath = path.join(rootDir, 'assets', 'company.png');

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
    if (!existsSync(templatePath)) throw new Error('Template not found');

    const templateSource = await fs.readFile(templatePath, 'utf-8');
    const assets = await this.loadAssets();
    const html = handlebars.compile(templateSource)({ ...data, ...assets });
    return this.renderToPdf(html);
  }

  async generateInvoicePdf(data: any): Promise<Buffer> {
    const templatePath = path.join(
      process.cwd(),
      'src',
      'templates',
      'invoice.hbs',
    );
    if (!existsSync(templatePath)) throw new Error('Template not found');

    const templateSource = await fs.readFile(templatePath, 'utf-8');
    const assets = await this.loadAssets();
    const html = handlebars.compile(templateSource)({ ...data, ...assets });
    return this.renderToPdf(html);
  }

  private async renderToPdf(html: string): Promise<Buffer> {
    let browser;
    try {
      // ✅ تم تغيير 'new' إلى true لتوافق الإصدارات القديمة
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', // ضروري جداً للينكس لتجنب امتلاء الذاكرة
          '--disable-gpu',
          '--disable-software-rasterizer',
        ],
      });

      const page = await browser.newPage();

      // ✅ استخدام networkidle0 لضمان تحميل الصور والخطوط قبل الطباعة
      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true, // لطباعة الألوان والخلفيات
        margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
      });

      return Buffer.from(pdfBuffer);
    } catch (error) {
      console.error('PDF Generation Error:', error);
      throw new InternalServerErrorException('Failed to generate PDF document');
    } finally {
      // ✅ التأكد من إغلاق المتصفح حتى لو حدث خطأ
      if (browser) await browser.close();
    }
  }
}
