import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * المبالغ من خانتين عشريتين إلى ثلاث: الدينار (الكويت، البحرين، الأردن، العراق،
 * تونس، ليبيا) والريال العُماني تُقسَّم إلى 1000 جزء. الخانة الأعلى في precision
 * تحفظ نفس عدد الخانات الصحيحة. عملات الخانتين لا تتأثر: مبالغها تُقرَّب
 * لخانتين قبل الحفظ (انظر common/utils/money.util).
 *
 * لا تشمل: نسب الضريبة، ساعات الحضور، أسعار الباقات وعروض الأسعار (بعملة المنصة).
 *
 * القائمة ثابتة هنا عمداً: الـ migration لقطة لا تتغير بتغيّر الـ entities لاحقاً.
 */
const MONEY_COLUMNS: Record<string, [column: string, precision: number][]> = {
  advances: [['amount', 13]],
  bonuses: [['amount', 13]],
  customer_payments: [['amount', 15]],
  customers: [
    ['creditLimit', 15],
    ['openingBalance', 15],
  ],
  deductions: [
    ['monthlyAmount', 13],
    ['totalAmount', 13],
  ],
  end_of_service: [
    ['eosAmount', 13],
    ['lastBasicSalary', 13],
  ],
  loans: [
    ['monthlyInstallment', 13],
    ['totalAmount', 13],
  ],
  payroll_items: [
    ['advance_deduction', 13],
    ['basicSalary', 13],
    ['bonuses_amount', 13],
    ['eos_amount', 13],
    ['housing_allowance', 13],
    ['loan_deduction', 13],
    ['netSalary', 13],
    ['other_allowances', 13],
    ['other_deductions', 13],
    ['overtimeAmount', 13],
    ['prepaid_allowances', 13],
    ['prepaid_bonuses', 13],
    ['prepaid_settlements', 13],
    ['settlements_amount', 13],
    ['transport_allowance', 13],
    ['unpaid_leave_deduction', 13],
  ],
  payrolls: [['totalNetSalary', 15]],
  pos_shifts: [
    ['cardTotal', 15],
    ['cashDifference', 15],
    ['cashRefunds', 15],
    ['cashTotal', 15],
    ['closingCash', 15],
    ['expectedCash', 15],
    ['openingCash', 15],
    ['returnsTotal', 15],
    ['salesTotal', 15],
  ],
  product_units: [['salePrice', 13]],
  products: [
    ['minSalePrice', 13],
    ['salePrice', 13],
  ],
  purchase_invoice_lines: [
    ['discount', 15],
    ['subtotal', 15],
    ['taxAmount', 15],
    ['total', 15],
  ],
  purchase_invoices: [
    ['discountTotal', 15],
    ['paidAmount', 15],
    ['returnedAmount', 15],
    ['subtotal', 15],
    ['taxTotal', 15],
    ['total', 15],
  ],
  purchase_return_lines: [
    ['subtotal', 15],
    ['taxAmount', 15],
    ['total', 15],
  ],
  purchase_returns: [
    ['subtotal', 15],
    ['taxTotal', 15],
    ['total', 15],
  ],
  salaries: [
    ['basicSalary', 13],
    ['housingAllowance', 13],
    ['otherAllowances', 13],
    ['totalSalary', 13],
    ['transportAllowance', 13],
  ],
  sales_invoice_lines: [
    ['discount', 15],
    ['subtotal', 15],
    ['taxAmount', 15],
    ['total', 15],
  ],
  sales_invoices: [
    ['costTotal', 15],
    ['discountTotal', 15],
    ['paidAmount', 15],
    ['returnedAmount', 15],
    ['subtotal', 15],
    ['taxTotal', 15],
    ['total', 15],
  ],
  sales_return_lines: [
    ['subtotal', 15],
    ['taxAmount', 15],
    ['total', 15],
  ],
  sales_returns: [
    ['refundedAmount', 15],
    ['subtotal', 15],
    ['taxTotal', 15],
    ['total', 15],
  ],
  settlements: [
    ['daily_rate', 13],
    ['total_amount', 13],
  ],
  supplier_payments: [['amount', 15]],
  suppliers: [['openingBalance', 15]],
};

export class MoneyThreeDecimals1791912100000 implements MigrationInterface {
  name = 'MoneyThreeDecimals1791912100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [table, columns] of Object.entries(MONEY_COLUMNS)) {
      // تعديل واحد لكل جدول: إعادة كتابة الجدول مرة واحدة لا مرة لكل عمود
      const changes = columns
        .map(
          ([column, precision]) =>
            `ALTER COLUMN "${column}" TYPE numeric(${precision},3)`,
        )
        .join(', ');
      await queryRunner.query(`ALTER TABLE "${table}" ${changes}`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ⚠️ يقرّب أي مبلغ بثلاث خانات إلى خانتين
    for (const [table, columns] of Object.entries(MONEY_COLUMNS)) {
      const changes = columns
        .map(
          ([column, precision]) =>
            `ALTER COLUMN "${column}" TYPE numeric(${precision - 1},2)`,
        )
        .join(', ');
      await queryRunner.query(`ALTER TABLE "${table}" ${changes}`);
    }
  }
}
