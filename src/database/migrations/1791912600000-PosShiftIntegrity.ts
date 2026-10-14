import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * سلامة ورديات الكاشير:
 * - وردية مفتوحة واحدة لكل جهاز (فهرس فريد جزئي): طلبا مزامنة متزامنان لا
 *   يفتحان ورديتين.
 * - عمليات وصلت بعد تقفيل الوردية: عددها ووقت آخر إعادة حساب.
 *
 * قبل الفهرس: إن وُجدت لجهاز أكثر من وردية مفتوحة (من السباق القديم) تبقى
 * الأحدث مفتوحة وتُقفَّل الأقدم بلا معدود، لتراجعها الإدارة.
 */
export class PosShiftIntegrity1791912600000 implements MigrationInterface {
  name = 'PosShiftIntegrity1791912600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pos_shifts" ADD "lateOperations" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_shifts" ADD "recalculatedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `UPDATE "pos_shifts" s
          SET "status" = 'closed', "closedAt" = now(),
              "note" = 'أُقفلت تلقائياً: وردية مفتوحة مكررة على نفس الجهاز'
        WHERE s."status" = 'open'
          AND EXISTS (
            SELECT 1 FROM "pos_shifts" o
             WHERE o."deviceId" = s."deviceId" AND o."status" = 'open'
               AND (o."openedAt", o."id") > (s."openedAt", s."id")
          )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_pos_shifts_open_device" ON "pos_shifts" ("deviceId") WHERE "status" = 'open'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_pos_shifts_open_device"`);
    await queryRunner.query(
      `ALTER TABLE "pos_shifts" DROP COLUMN "recalculatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_shifts" DROP COLUMN "lateOperations"`,
    );
  }
}
