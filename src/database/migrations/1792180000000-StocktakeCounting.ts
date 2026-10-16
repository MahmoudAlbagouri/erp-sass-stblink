import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * شاشة العدّ (جرد بلا إنترنت من أكثر من جهاز):
 *
 * - stocktake_lines.countedAt: متى عُدّ الصنف آخر مرة (من الجهاز). يحسم بين
 *   عدّين لنفس الصنف وصلا بترتيب غير ترتيب وقوعهما: الأحدث يكسب.
 * - stocktake_lines.countedById: من عدّه.
 *
 * السطور الموجودة تبقى بلا وقت عدّ (null): أي عدّ جديد يغلبها.
 */
export class StocktakeCounting1792180000000 implements MigrationInterface {
  name = 'StocktakeCounting1792180000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stocktake_lines" ADD "countedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "stocktake_lines" ADD "countedById" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "stocktake_lines" DROP COLUMN "countedById"`,
    );
    await queryRunner.query(
      `ALTER TABLE "stocktake_lines" DROP COLUMN "countedAt"`,
    );
  }
}
