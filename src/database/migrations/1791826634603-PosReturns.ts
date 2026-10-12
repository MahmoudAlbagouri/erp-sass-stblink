import { MigrationInterface, QueryRunner } from 'typeorm';

export class PosReturns1791826634603 implements MigrationInterface {
  name = 'PosReturns1791826634603';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sales_returns" ADD "uuid" uuid`);
    await queryRunner.query(`ALTER TABLE "sales_returns" ADD "deviceId" uuid`);
    await queryRunner.query(`ALTER TABLE "sales_returns" ADD "shiftId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "pos_shifts" ADD "returnsCount" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_shifts" ADD "returnsTotal" numeric(14,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_shifts" ADD "cashRefunds" numeric(14,2) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_shifts" ADD "drawerOpens" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c2dbe62dd1c6abdde3d8589be3" ON "sales_returns" ("shiftId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_e80ff5abe852a1477f61a4a6e7" ON "sales_returns" ("tenantId", "uuid") WHERE "uuid" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e80ff5abe852a1477f61a4a6e7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c2dbe62dd1c6abdde3d8589be3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_shifts" DROP COLUMN "drawerOpens"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_shifts" DROP COLUMN "cashRefunds"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_shifts" DROP COLUMN "returnsTotal"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_shifts" DROP COLUMN "returnsCount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_returns" DROP COLUMN "shiftId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_returns" DROP COLUMN "deviceId"`,
    );
    await queryRunner.query(`ALTER TABLE "sales_returns" DROP COLUMN "uuid"`);
  }
}
