// src/common/reports/report.service.ts
import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

@Injectable()
export class ReportService {
  private getLogoBase64(): string {
    try {
      const logoPath = path.join(process.cwd(), 'assets', 'logo.png');
      return (
        'data:image/png;base64,' +
        fs.readFileSync(logoPath, { encoding: 'base64' })
      );
    } catch {
      return '';
    }
  }

  // بناء HTML للتقرير مع دعم RTL والعربية
  private buildHtmlTemplate(
    data: any[],
    columns: { header: string; key: string }[],
    title: string,
  ): string {
    const logoBase64 = this.getLogoBase64();
    const logoImg = logoBase64
      ? `<img src="${logoBase64}" class="logo" alt="Logo" />`
      : '';

    const tableHeaders = columns.map((c) => `<th>${c.header}</th>`).join('');

    const tableRows = data
      .map((row) => {
        const cells = columns
          .map((c) => {
            const rowData = row as Record<string, any>;
            return `<td>${rowData[c.key] ?? ''}</td>`;
          })
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');

    return `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap');

          * { margin: 0; padding: 0; box-sizing: border-box; }

          body {
            font-family: 'Cairo', Arial, sans-serif;
            direction: rtl;
            color: #333;
            padding: 30px;
            background: #fff;
          }

          .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-bottom: 3px solid #0056b3;
            padding-bottom: 15px;
            margin-bottom: 25px;
          }

          .logo { height: 55px; object-fit: contain; }

          .company-name {
            font-size: 13px;
            color: #666;
            text-align: left;
          }

          h1 {
            font-size: 22px;
            color: #0056b3;
            margin-bottom: 20px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
          }

          th {
            background-color: #0056b3;
            color: #fff;
            padding: 10px 12px;
            text-align: center;
            font-weight: 700;
          }

          td {
            padding: 9px 12px;
            text-align: center;
            border-bottom: 1px solid #e0e0e0;
          }

          tr:nth-child(even) td { background-color: #f4f8ff; }
          tr:hover td { background-color: #e8f0fe; }

          .footer {
            margin-top: 30px;
            font-size: 11px;
            color: #999;
            text-align: center;
            border-top: 1px solid #e0e0e0;
            padding-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          ${logoImg}
          <div class="company-name">STB ERP System</div>
        </div>

        <h1>${title}</h1>

        <table>
          <thead><tr>${tableHeaders}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>

        <div class="footer">
          تاريخ التقرير: ${new Date().toLocaleDateString('ar-SA')}
        </div>
      </body>
      </html>
    `;
  }

  async generateExcel(
    data: any[],
    columns: { header: string; key: string }[],
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Report');

    // ✅ تفعيل الاتجاه من اليمين لليسار (RTL) للجدول بالكامل
    worksheet.views = [{ state: 'frozen', ySplit: 1, rightToLeft: true }];

    worksheet.columns = columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: 25,
    }));

    // تنسيق رأس الجدول
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0056B3' },
      };
      cell.font = {
        color: { argb: 'FFFFFFFF' },
        bold: true,
        name: 'Cairo', // ✅ استخدام خط عربي موحد
        size: 11,
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    headerRow.height = 28;

    // إضافة البيانات وتنسيق الخلايا
    const dataRows = worksheet.addRows(data);
    dataRows.forEach((row) => {
      row.eachCell((cell) => {
        cell.font = { name: 'Cairo', size: 10 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        };
      });
    });

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  async generatePdf(
    data: any[],
    columns: { header: string; key: string }[],
    title: string,
  ): Promise<Buffer> {
    const html = this.buildHtmlTemplate(data, columns, title);

    // إنشاء مجلد مؤقت فريد لتجنب تعارض الملفات المقفلة
    // لن تظهر أي خطوط حمراء بعد الآن
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puppeteer-'));

    const browser = await puppeteer.launch({
      headless: true,
      userDataDir: tempDir, // تحديد مسار فريد لكل عملية
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' }); // استخدام load لضمان تحميل المحتوى

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '40px', bottom: '40px', left: '20px', right: '20px' },
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
      // تنظيف المجلد المؤقت بعد إغلاق المتصفح
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }
}
