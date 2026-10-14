import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * تغيير سعر صنف في فاتورة كاشير بعينها، والصنف بسعر مفتوح.
 *
 * - products.openPrice: الشاشة تطلب السعر عند إضافة الصنف.
 * - pos_cashiers.canChangePrice: يغيّر الكاشير السعر بنفسه في حدود خصمه
 *   (الافتراضي نعم؛ بدونها يحتاج مشرفاً).
 * - sales_invoice_lines.listPrice / priceReason: السعر الأصلي وسبب التغيير.
 * - موافقة المشرف على تغيير السعر في sales_settings.posOptions.approvals
 *   (priceChange) — jsonb، الغائب = false، فلا عمود.
 */
export class PosPriceOverride1791912800000 implements MigrationInterface {
  name = 'PosPriceOverride1791912800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD "openPrice" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_cashiers" ADD "canChangePrice" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_invoice_lines" ADD "listPrice" numeric(14,4)`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_invoice_lines" ADD "priceReason" character varying(200)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales_invoice_lines" DROP COLUMN "priceReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_invoice_lines" DROP COLUMN "listPrice"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_cashiers" DROP COLUMN "canChangePrice"`,
    );
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "openPrice"`);
  }
}
