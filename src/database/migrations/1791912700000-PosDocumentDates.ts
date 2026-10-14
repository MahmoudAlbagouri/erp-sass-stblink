import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * تواريخ مستندات الكاشير بتوقيت الشركة.
 *
 * كان تاريخ فاتورة الكاشير ومرتجعه وسنداتهما يُحسب بساعة السيرفر (UTC)، فبيع
 * الساعة 1:30 فجراً بالرياض يوم 15 سُجّل بتاريخ 14. هنا يُعاد حسابها من لحظة
 * الإصدار (issuedAt) بتوقيت كل شركة:
 *
 * - فاتورة الكاشير: invoiceDate، ويُزاح dueDate بنفس الفرق (آجلها يبقى بنفس
 *   المهلة).
 * - سند قبض فاتورة الكاشير عند البيع (يحمل ورديته): paymentDate = تاريخ الفاتورة.
 * - مرتجع الكاشير: returnDate، وسند ردّ مبلغه: paymentDate = تاريخ المرتجع.
 *
 * فواتير لوحة التحكم لا تُمسّ: تاريخها يختاره المستخدم. منطقة غير صالحة ←
 * Asia/Riyadh (ما كانت تعمل به الشركات قبل تعدد الدول).
 */
const ZONE = `COALESCE(
  (SELECT z."name" FROM pg_timezone_names z WHERE z."name" = t."timezone" LIMIT 1),
  'Asia/Riyadh'
)`;

export class PosDocumentDates1791912700000 implements MigrationInterface {
  name = 'PosDocumentDates1791912700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const invoiceDay = `(i."issuedAt" AT TIME ZONE ${ZONE})::date`;
    await queryRunner.query(
      `UPDATE sales_invoices i
          SET "invoiceDate" = ${invoiceDay},
              "dueDate" = i."dueDate" + (${invoiceDay} - i."invoiceDate")
         FROM tenants t
        WHERE t."id" = i."tenantId"
          AND i."deviceId" IS NOT NULL AND i."issuedAt" IS NOT NULL
          AND i."invoiceDate" <> ${invoiceDay}`,
    );
    await queryRunner.query(
      `UPDATE customer_payments p
          SET "paymentDate" = i."invoiceDate"
         FROM sales_invoices i
        WHERE i."id" = p."invoiceId" AND i."deviceId" IS NOT NULL
          AND p."shiftId" IS NOT NULL AND p."salesReturnId" IS NULL
          AND p."paymentDate" <> i."invoiceDate"`,
    );
    await queryRunner.query(
      `UPDATE sales_returns r
          SET "returnDate" = (r."issuedAt" AT TIME ZONE ${ZONE})::date
         FROM tenants t
        WHERE t."id" = r."tenantId"
          AND r."deviceId" IS NOT NULL AND r."issuedAt" IS NOT NULL
          AND r."returnDate" <> (r."issuedAt" AT TIME ZONE ${ZONE})::date`,
    );
    await queryRunner.query(
      `UPDATE customer_payments p
          SET "paymentDate" = r."returnDate"
         FROM sales_returns r
        WHERE r."id" = p."salesReturnId" AND r."deviceId" IS NOT NULL
          AND p."paymentDate" <> r."returnDate"`,
    );
  }

  public async down(): Promise<void> {
    // التواريخ السابقة كانت خطأً بتوقيت السيرفر: لا يُعاد إليها
  }
}
