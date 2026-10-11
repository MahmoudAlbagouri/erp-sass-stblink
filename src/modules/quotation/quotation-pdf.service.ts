// src/modules/quotation/quotation-pdf.service.ts
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as handlebars from 'handlebars';
import * as puppeteer from 'puppeteer';

@Injectable()
export class QuotationPdfService {
  private readonly logger = new Logger(QuotationPdfService.name);

  private getImageBase64(filePath: string): string {
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

  private loadAssets(): { logo: string; companyImage: string } {
    const rootDir = process.cwd();
    const logoPath = path.join(rootDir, 'assets', 'logo.png');
    const companyImagePath = path.join(rootDir, 'assets', 'company.png');

    return {
      logo: this.getImageBase64(logoPath),
      companyImage: this.getImageBase64(companyImagePath),
    };
  }

  async generatePdf(data: Record<string, unknown>): Promise<Buffer> {
    const templatePath = path.join(
      process.cwd(),
      'src',
      'templates',
      'quotation.hbs',
    );
    if (!fs.existsSync(templatePath)) throw new Error('Template not found');

    const templateSource = fs.readFileSync(templatePath, 'utf-8');
    const assets = this.loadAssets();
    const html = handlebars.compile(templateSource)({ ...data, ...assets });
    return this.renderToPdf(html);
  }

  async generateInvoicePdf(data: Record<string, unknown>): Promise<Buffer> {
    const templatePath = path.join(
      process.cwd(),
      'src',
      'templates',
      'invoice.hbs',
    );
    if (!fs.existsSync(templatePath)) throw new Error('Template not found');

    const templateSource = fs.readFileSync(templatePath, 'utf-8');
    const assets = this.loadAssets();
    const html = handlebars.compile(templateSource)({ ...data, ...assets });
    return this.renderToPdf(html);
  }

  private async renderToPdf(html: string): Promise<Buffer> {
    // ✅ إنشاء مجلد مؤقت فريد لتجنب تعارض الملفات المقفلة (نفس أسلوب ReportService)
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'puppeteer-quotation-'),
    );

    let browser: puppeteer.Browser | undefined;
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

      await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
      // انتظار هدوء الشبكة لضمان تحميل الصور والخطوط بالكامل
      await page.waitForNetworkIdle({ timeout: 30000 });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
      });

      return Buffer.from(pdfBuffer);
    } catch (error) {
      this.logger.error('PDF Generation Error', error);
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
