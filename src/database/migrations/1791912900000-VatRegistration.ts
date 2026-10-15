import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * التسجيل في ضريبة القيمة المضافة وأساس التسعير، على مستوى الشركة:
 *
 * - sales_settings.vatRegistered: منشأة غير مسجّلة تبيع بلا ضريبة، بفاتورة
 *   "فاتورة مبيعات" بلا رقم ضريبي ولا QR، وضريبة مشترياتها تدخل في التكلفة.
 * - sales_settings.pricesIncludeTax: أسعار البيع شاملة الضريبة أو قبلها.
 *
 * الشركات الموجودة تبقى كما كانت تعمل: مسجّلة وأسعارها شاملة — إلا شركات دول
 * بلا ضريبة قيمة مضافة، فتصبح غير مسجّلة. القائمة منسوخة هنا عمداً (لا تُستورد
 * من constants): الـ migration لقطة ثابتة.
 */
const NO_VAT_COUNTRIES = ['KW', 'QA', 'IQ', 'SY', 'LY'];

export class VatRegistration1791912900000 implements MigrationInterface {
  name = 'VatRegistration1791912900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales_settings" ADD "vatRegistered" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_settings" ADD "pricesIncludeTax" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `UPDATE "sales_settings" s SET "vatRegistered" = false
         FROM "tenants" t
        WHERE t."id" = s."tenantId" AND t."country" = ANY($1::text[])`,
      [NO_VAT_COUNTRIES],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sales_settings" DROP COLUMN "pricesIncludeTax"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_settings" DROP COLUMN "vatRegistered"`,
    );
  }
}
