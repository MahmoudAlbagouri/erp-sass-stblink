import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * دعم تعدد الدول: عملة لكل شركة، الدولة كرمز ISO، والمنطقة الزمنية بصيغة IANA.
 *
 * الشركات الموجودة أُنشئت والنظام سعودي فقط: ما لا يُعرف من قيم الدولة النصية
 * القديمة يُعامل كالسعودية (ريال، توقيت الرياض) — وهو ما كانت تعمل به فعلاً.
 *
 * القائمة منسوخة هنا عمداً (لا تُستورد من constants): الـ migration لقطة ثابتة
 * لا تتغير بتغيّر الكود لاحقاً.
 */
const COUNTRIES: [
  code: string,
  currency: string,
  timezone: string,
  names: string[],
][] = [
  [
    'SA',
    'SAR',
    'Asia/Riyadh',
    ['السعودية', 'المملكة العربية السعودية', 'saudi arabia', 'ksa'],
  ],
  ['EG', 'EGP', 'Africa/Cairo', ['مصر', 'جمهورية مصر العربية', 'egypt']],
  [
    'AE',
    'AED',
    'Asia/Dubai',
    ['الإمارات', 'الامارات', 'الإمارات العربية المتحدة', 'uae'],
  ],
  ['KW', 'KWD', 'Asia/Kuwait', ['الكويت', 'kuwait']],
  ['QA', 'QAR', 'Asia/Qatar', ['قطر', 'qatar']],
  ['BH', 'BHD', 'Asia/Bahrain', ['البحرين', 'bahrain']],
  ['OM', 'OMR', 'Asia/Muscat', ['عُمان', 'عمان', 'سلطنة عمان', 'oman']],
  ['JO', 'JOD', 'Asia/Amman', ['الأردن', 'الاردن', 'jordan']],
  ['IQ', 'IQD', 'Asia/Baghdad', ['العراق', 'iraq']],
  ['LB', 'LBP', 'Asia/Beirut', ['لبنان', 'lebanon']],
  ['SY', 'SYP', 'Asia/Damascus', ['سوريا', 'سورية', 'syria']],
  ['YE', 'YER', 'Asia/Aden', ['اليمن', 'yemen']],
  ['PS', 'ILS', 'Asia/Hebron', ['فلسطين', 'palestine']],
  ['LY', 'LYD', 'Africa/Tripoli', ['ليبيا', 'libya']],
  ['TN', 'TND', 'Africa/Tunis', ['تونس', 'tunisia']],
  ['DZ', 'DZD', 'Africa/Algiers', ['الجزائر', 'algeria']],
  ['MA', 'MAD', 'Africa/Casablanca', ['المغرب', 'morocco']],
  ['SD', 'SDG', 'Africa/Khartoum', ['السودان', 'sudan']],
];

export class TenantLocalization1791912000000 implements MigrationInterface {
  name = 'TenantLocalization1791912000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tenants" ADD "currency" character varying(3) NOT NULL DEFAULT 'SAR'`,
    );
    await queryRunner.query(
      `ALTER TABLE "tenants" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Riyadh'`,
    );

    // الدولة: من نص حر إلى رمز ISO
    for (const [code, , , names] of COUNTRIES) {
      await queryRunner.query(
        `UPDATE "tenants" SET "country" = $1
         WHERE lower(trim("country")) = ANY($2::text[])`,
        [code, [code.toLowerCase(), ...names]],
      );
    }
    await queryRunner.query(
      `UPDATE "tenants" SET "country" = 'SA'
       WHERE "country" IS NULL OR "country" <> ALL($1::text[])`,
      [COUNTRIES.map(([code]) => code)],
    );

    // العملة والمنطقة الزمنية حسب الدولة
    for (const [code, currency, timezone] of COUNTRIES) {
      await queryRunner.query(
        `UPDATE "tenants" SET "currency" = $2, "timezone" = $3
         WHERE "country" = $1`,
        [code, currency, timezone],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // قيم الدولة النصية الأصلية لا تُسترجع؛ الرموز تبقى في العمود
    await queryRunner.query(`UPDATE "tenants" SET "timezone" = 'UTC+3'`);
    await queryRunner.query(
      `ALTER TABLE "tenants" ALTER COLUMN "timezone" SET DEFAULT 'UTC+3'`,
    );
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN "currency"`);
  }
}
