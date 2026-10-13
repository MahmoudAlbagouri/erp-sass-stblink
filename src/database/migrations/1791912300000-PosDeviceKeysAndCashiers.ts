import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * الكاشير بلا إنترنت:
 * - مفتاح لكل جهاز كاشير (بصمته فقط) ليرفع مبيعاته دون جلسة مستخدم.
 * - كاشيرات بأرقام سرية يفتحون ورديّاتهم على الجهاز، والوردية تُنسب لكاشيرها.
 *
 * الأجهزة المربوطة حالياً تبقى مربوطة بلا مفتاح: تحصل عليه تلقائياً عند أول
 * اتصال لها بجلسة مستخدم.
 */
export class PosDeviceKeysAndCashiers1791912300000 implements MigrationInterface {
  name = 'PosDeviceKeysAndCashiers1791912300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "pos_cashiers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "name" character varying(150) NOT NULL, "pinSalt" character varying(64) NOT NULL, "pinHash" character varying(128) NOT NULL, "pinIterations" integer NOT NULL, "canReturn" boolean NOT NULL DEFAULT false, "returnRevokedAt" TIMESTAMP WITH TIME ZONE, "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_a08d72c712608edbfa1d552a1d1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8fd6d5efb8d020363e7b0df7de" ON "pos_cashiers" ("tenantId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_devices" ADD "keyHash" character varying(64)`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_devices" ADD "returnsAllowed" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`ALTER TABLE "pos_shifts" ADD "cashierId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "pos_cashiers" ADD CONSTRAINT "FK_8fd6d5efb8d020363e7b0df7de2" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pos_cashiers" DROP CONSTRAINT "FK_8fd6d5efb8d020363e7b0df7de2"`,
    );
    await queryRunner.query(`ALTER TABLE "pos_shifts" DROP COLUMN "cashierId"`);
    await queryRunner.query(
      `ALTER TABLE "pos_devices" DROP COLUMN "returnsAllowed"`,
    );
    await queryRunner.query(`ALTER TABLE "pos_devices" DROP COLUMN "keyHash"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8fd6d5efb8d020363e7b0df7de"`,
    );
    await queryRunner.query(`DROP TABLE "pos_cashiers"`);
  }
}
