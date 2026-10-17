import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * المحاسبة — سندات الصرف وإقفال السنة (docs/modules/accounting.md):
 *
 * - expense_vouchers / expense_voucher_lines: سند صرف (مصروف يُدفع من صندوق
 *   أو بنك) ببنوده وضريبتها، يُقيَّد فور حفظه ويُلغى بقيد عكسي.
 * - accounting_settings.closedThroughYear: آخر سنة مالية أُقفلت.
 */

export class ExpensesYearEnd1792223634101 implements MigrationInterface {
    name = 'ExpensesYearEnd1792223634101'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."expense_vouchers_status_enum" AS ENUM('posted', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "expense_vouchers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "number" character varying(20) NOT NULL, "date" date NOT NULL, "paidFromAccountId" uuid NOT NULL, "payee" character varying(150) NOT NULL, "payeeTaxNumber" character varying(30), "reference" character varying(80), "description" character varying(500) NOT NULL, "status" "public"."expense_vouchers_status_enum" NOT NULL DEFAULT 'posted', "subtotal" numeric(18,3) NOT NULL DEFAULT '0', "taxTotal" numeric(18,3) NOT NULL DEFAULT '0', "total" numeric(18,3) NOT NULL DEFAULT '0', "taxRecoverable" boolean NOT NULL DEFAULT false, "journalEntryId" uuid, "cancelledAt" TIMESTAMP WITH TIME ZONE, "cancelDate" date, "cancelReason" character varying(300), "cancelJournalEntryId" uuid, "createdById" uuid, CONSTRAINT "PK_364d488d83ef72cbb7af1694c2c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_97e05a7ce30adf8f5b3904b7bd" ON "expense_vouchers" ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_d98d79b4f6514e224d1a6dae50" ON "expense_vouchers" ("tenantId", "date") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_76b8a0b0a1b69449c960bdfa6e" ON "expense_vouchers" ("tenantId", "number") `);
        await queryRunner.query(`CREATE TABLE "expense_voucher_lines" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "voucherId" uuid NOT NULL, "lineOrder" integer NOT NULL DEFAULT '0', "accountId" uuid NOT NULL, "description" character varying(300), "amount" numeric(18,3) NOT NULL DEFAULT '0', "taxRate" numeric(5,2) NOT NULL DEFAULT '0', "taxAmount" numeric(18,3) NOT NULL DEFAULT '0', "total" numeric(18,3) NOT NULL DEFAULT '0', "branchId" uuid, CONSTRAINT "PK_9e57ac6828f3e07e87746929de8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_d9e2610737f4b5576443b1f6f3" ON "expense_voucher_lines" ("voucherId") `);
        await queryRunner.query(`ALTER TABLE "accounting_settings" ADD "closedThroughYear" integer`);
        await queryRunner.query(`ALTER TABLE "expense_vouchers" ADD CONSTRAINT "FK_97e05a7ce30adf8f5b3904b7bde" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expense_vouchers" ADD CONSTRAINT "FK_7568d4d8086fbb8886325c3c5ff" FOREIGN KEY ("paidFromAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expense_voucher_lines" ADD CONSTRAINT "FK_d9e2610737f4b5576443b1f6f34" FOREIGN KEY ("voucherId") REFERENCES "expense_vouchers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "expense_voucher_lines" ADD CONSTRAINT "FK_5b6ee442eae112555ecbb03492d" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "expense_voucher_lines" DROP CONSTRAINT "FK_5b6ee442eae112555ecbb03492d"`);
        await queryRunner.query(`ALTER TABLE "expense_voucher_lines" DROP CONSTRAINT "FK_d9e2610737f4b5576443b1f6f34"`);
        await queryRunner.query(`ALTER TABLE "expense_vouchers" DROP CONSTRAINT "FK_7568d4d8086fbb8886325c3c5ff"`);
        await queryRunner.query(`ALTER TABLE "expense_vouchers" DROP CONSTRAINT "FK_97e05a7ce30adf8f5b3904b7bde"`);
        await queryRunner.query(`ALTER TABLE "accounting_settings" DROP COLUMN "closedThroughYear"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d9e2610737f4b5576443b1f6f3"`);
        await queryRunner.query(`DROP TABLE "expense_voucher_lines"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_76b8a0b0a1b69449c960bdfa6e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d98d79b4f6514e224d1a6dae50"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_97e05a7ce30adf8f5b3904b7bd"`);
        await queryRunner.query(`DROP TABLE "expense_vouchers"`);
        await queryRunner.query(`DROP TYPE "public"."expense_vouchers_status_enum"`);
    }

}
