// src/common/reports/report.service.ts
import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

@Injectable()
export class ReportService {
  // ✅ ألوان الهوية البصرية لـ STB
  private readonly brand = {
    primary: '#0a4fa8',
    primaryLight: '#1a6fd4',
    primaryDark: '#062d6b',
    accent: '#00aaff',
    accentGlow: '#00d4ff',
    dark: '#0d1117',
    surface: '#111827',
    surface2: '#1a2332',
    border: '#1e3a5f',
    textPrimary: '#e8f1ff',
    textSecondary: '#7a9cc4',
    textMuted: '#4a6a8a',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
  };

  /**
   * ✅ قراءة اللوجو وتحويله لـ Base64 لضمان ظهوره في Puppeteer
   */
  private getLogoBase64(): string {
    try {
      // البحث عن اللوجو في مجلد assets بجوار package.json
      const logoPath = path.join(process.cwd(), 'assets', 'logo.png');

      if (!fs.existsSync(logoPath)) {
        console.warn(`⚠️ لم يتم العثور على اللوجو في: ${logoPath}`);
        return '';
      }

      const imageBuffer = fs.readFileSync(logoPath);
      return `data:image/png;base64,${imageBuffer.toString('base64')}`;
    } catch (error) {
      console.error('❌ خطأ في قراءة ملف اللوجو:', error);
      return '';
    }
  }

  private buildHtmlTemplate(
    data: any[],
    columns: { header: string; key: string }[],
    title: string,
  ): string {
    const b = this.brand;
    const logoBase64 = this.getLogoBase64();

    // ✅ استخدام اللوجو الحقيقي بدون فلاتر تدميرية
    const logoImg = logoBase64
      ? `<img src="${logoBase64}" class="logo" alt="STB Logo" />`
      : `<div class="logo-fallback">STB</div>`;

    const tableHeaders = columns.map((c) => `<th>${c.header}</th>`).join('');

    const tableRows = data
      .map((row, i) => {
        const cells = columns
          .map((c) => {
            const rowData = row as Record<string, any>;
            return `<td>${rowData[c.key] ?? '—'}</td>`;
          })
          .join('');
        return `<tr data-index="${i}">${cells}</tr>`;
      })
      .join('');

    const issueDate = new Date().toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    return `
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8" />
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');

          :root {
            --primary: ${b.primary};
            --primary-light: ${b.primaryLight};
            --primary-dark: ${b.primaryDark};
            --accent: ${b.accent};
            --accent-glow: ${b.accentGlow};
            --dark: ${b.dark};
            --surface: ${b.surface};
            --surface-2: ${b.surface2};
            --border: ${b.border};
            --text-secondary: ${b.textSecondary};
            --text-muted: ${b.textMuted};
          }

          * { margin: 0; padding: 0; box-sizing: border-box; }

          body {
            font-family: 'Cairo', Arial, sans-serif;
            direction: rtl;
            color: #1c2b3a;
            background: #fff;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          /* ===== Header ===== */
          .report-header {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 22px 34px;
            background: linear-gradient(135deg, var(--primary-dark) 0%, var(--primary) 55%, var(--primary-light) 100%);
            overflow: hidden;
          }

          .report-header::before {
            content: "";
            position: absolute;
            inset: 0;
            background: repeating-linear-gradient(
              65deg,
              rgba(199, 211, 224, 0.08) 0px,
              rgba(199, 211, 224, 0.08) 2px,
              transparent 2px,
              transparent 14px
            );
            pointer-events: none;
          }

          .report-header::after {
            content: "";
            position: absolute;
            top: -60px;
            left: -60px;
            width: 180px;
            height: 180px;
            background: radial-gradient(circle, rgba(0, 212, 255, 0.35) 0%, transparent 70%);
            filter: blur(6px);
          }

          .report-header__brand {
            display: flex;
            align-items: center;
            gap: 14px;
            z-index: 1;
          }

          /* ✅ تم إزالة filter: brightness(0) invert(1) الذي كان يسبب المشكلة */
          .logo { 
            height: 50px; 
            width: auto;
            object-fit: contain; 
          }
          
          .logo-fallback {
            font-weight: 800;
            font-size: 20px;
            letter-spacing: 2px;
            color: #fff;
            border: 2px solid rgba(255,255,255,0.6);
            padding: 6px 12px;
            border-radius: 8px;
          }

          .report-header__meta {
            display: flex;
            flex-direction: column;
            gap: 2px;
          }
          .report-header__company {
            color: #fff;
            font-weight: 700;
            font-size: 15px;
          }
          .report-header__tagline {
            color: rgba(232, 241, 255, 0.75);
            font-size: 11px;
          }

          .report-header__badge {
            z-index: 1;
            font-size: 11px;
            font-weight: 700;
            color: var(--accent-glow);
            border: 1px solid rgba(0, 212, 255, 0.5);
            background: rgba(0, 170, 255, 0.12);
            padding: 5px 14px;
            border-radius: 999px;
            letter-spacing: 0.5px;
          }

          .report-header__underline {
            height: 3px;
            background: linear-gradient(90deg, var(--accent) 0%, var(--accent-glow) 50%, transparent 100%);
            box-shadow: 0 0 10px rgba(0, 212, 255, 0.6);
          }

          /* ===== Title Block ===== */
          .report-title {
            padding: 26px 34px 14px;
          }
          .report-title h1 {
            font-size: 21px;
            font-weight: 800;
            color: var(--primary-dark);
            letter-spacing: 0.2px;
          }
          .report-title__underline {
            width: 60px;
            height: 4px;
            border-radius: 4px;
            margin-top: 8px;
            background: linear-gradient(90deg, var(--accent), var(--accent-glow));
            box-shadow: 0 0 8px rgba(0, 170, 255, 0.4);
          }
          .report-meta-row {
            display: flex;
            gap: 20px;
            margin-top: 12px;
            font-size: 11.5px;
            color: var(--text-secondary);
          }
          .report-meta-row span {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .report-meta-row span::before {
            content: "";
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--accent);
          }

          /* ===== Table Card ===== */
          .report-card {
            margin: 0 34px 30px;
            border: 1px solid #dbe6f2;
            border-radius: 14px;
            overflow: hidden;
            box-shadow: 0 2px 14px rgba(10, 79, 168, 0.08);
          }

          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12.5px;
          }

          th {
            background: linear-gradient(135deg, var(--primary-dark), var(--primary));
            color: #fff;
            padding: 12px 14px;
            text-align: center;
            font-weight: 700;
            font-size: 11.5px;
            letter-spacing: 0.3px;
            border-bottom: 2px solid var(--accent-glow);
          }

          td {
            padding: 10px 14px;
            text-align: center;
            color: #2a3b4d;
            border-bottom: 1px solid #eaf1f8;
          }

          tbody tr {
            page-break-inside: avoid;
          }
          tbody tr:nth-child(even) td {
            background-color: #f4f8fd;
          }
          tbody tr:last-child td {
            border-bottom: none;
          }

          /* ===== Footer ===== */
          .report-footer {
            position: relative;
            margin-top: 24px;
            padding: 16px 34px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: linear-gradient(135deg, var(--primary-dark) 0%, var(--dark) 100%);
            overflow: hidden;
          }
          .report-footer::before {
            content: "";
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 2px;
            background: linear-gradient(90deg, transparent, var(--accent-glow), transparent);
          }
          .report-footer__brand {
            color: #fff;
            font-weight: 800;
            font-size: 13px;
            letter-spacing: 1px;
            z-index: 1;
          }
          .report-footer__brand span {
            color: var(--accent-glow);
          }
          .report-footer__meta {
            color: rgba(232, 241, 255, 0.6);
            font-size: 10.5px;
            z-index: 1;
          }
        </style>
      </head>
      <body>

        <div class="report-header">
          <div class="report-header__brand">
            ${logoImg}
            <div class="report-header__meta">
              <span class="report-header__company">STB ERP System</span>
              <span class="report-header__tagline">نظام إدارة الموارد البشرية والمؤسسات</span>
            </div>
          </div>
          <div class="report-header__badge">تقرير رسمي</div>
        </div>
        <div class="report-header__underline"></div>

        <div class="report-title">
          <h1>${title}</h1>
          <div class="report-title__underline"></div>
          <div class="report-meta-row">
            <span>عدد السجلات: ${data.length}</span>
            <span>تاريخ الإصدار: ${issueDate}</span>
          </div>
        </div>

        <div class="report-card">
          <table>
            <thead><tr>${tableHeaders}</tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>

        <div class="report-footer">
          <div class="report-footer__brand">STB<span>ERP</span></div>
          <div class="report-footer__meta">تم إصدار هذا التقرير آليًا عبر نظام STB ERP</div>
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

    worksheet.views = [{ state: 'frozen', ySplit: 1, rightToLeft: true }];

    worksheet.columns = columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: 25,
    }));

    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0A4FA8' },
      };
      cell.font = {
        color: { argb: 'FFE8F1FF' },
        bold: true,
        name: 'Cairo',
        size: 11,
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        bottom: { style: 'medium', color: { argb: 'FF00D4FF' } },
      };
    });
    headerRow.height = 30;

    const dataRows = worksheet.addRows(data);
    dataRows.forEach((row, i) => {
      row.eachCell((cell) => {
        cell.font = { name: 'Cairo', size: 10, color: { argb: 'FF2A3B4D' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFE0E8F2' } },
        };
        if (i % 2 === 1) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF4F8FD' },
          };
        }
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

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puppeteer-'));

    const browser = await puppeteer.launch({
      headless: true,
      userDataDir: tempDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    try {
      const page = await browser.newPage();
      // ✅ networkidle0 يضمن تحميل صور Base64 بالكامل قبل التوليد
      await page.setContent(html, { waitUntil: 'load' });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' },
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }
}
