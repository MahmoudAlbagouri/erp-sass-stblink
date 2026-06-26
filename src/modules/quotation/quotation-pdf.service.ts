// src/modules/quotation/quotation-pdf.service.ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as handlebars from 'handlebars';
import * as puppeteer from 'puppeteer';

@Injectable()
export class QuotationPdfService {
  private async getImageBase64(filePath: string): Promise<string> {
    try {
      if (!fs.existsSync(filePath)) return '';
      const buffer = fs.readFileSync(filePath);
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
    if (!fs.existsSync(templatePath)) throw new Error('Template not found');

    const templateSource = fs.readFileSync(templatePath, 'utf-8');
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
    if (!fs.existsSync(templatePath)) throw new Error('Template not found');

    const templateSource = fs.readFileSync(templatePath, 'utf-8');
    const assets = await this.loadAssets();
    const html = handlebars.compile(templateSource)({ ...data, ...assets });
    return this.renderToPdf(html);
  }

  private async renderToPdf(html: string): Promise<Buffer> {
    // ✅ إنشاء مجلد مؤقت فريد لتجنب تعارض الملفات المقفلة (نفس أسلوب ReportService)
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'puppeteer-quotation-'),
    );

    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        userDataDir: tempDir, // تحديد مسار فريد لكل عملية
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      const page = await browser.newPage();

      // استخدام networkidle0 لضمان تحميل الصور والخطوط بالكامل
      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
      });

      return Buffer.from(pdfBuffer);
    } catch (error) {
      console.error('PDF Generation Error:', error);
      throw new InternalServerErrorException('Failed to generate PDF document');
    } finally {
      // ✅ إغلاق المتصفح وتنظيف المجلد المؤقت دائماً
      if (browser) await browser.close();
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }
}
