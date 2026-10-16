import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * موديول المحاسبة (docs/modules/accounting.md):
 *
 * - accounts: شجرة حسابات كل شركة (تُنشأ من شجرة دولتها عند التفعيل).
 * - journal_entries / journal_lines: قيود اليومية — لا تُعدَّل، ولكل مستند
 *   وحدث قيد واحد (فهرس فريد على المصدر).
 * - accounting_settings: التفعيل وبداية الدفاتر وقفل الفترة وحسابات طرق الدفع.
 * - accounting_posting_errors / accounting_skipped_sources: ما تعذّر ترحيله،
 *   وما لا أثر محاسبياً له.
 * - accounting_opening_baselines: أرصدة العملاء والموردين الافتتاحية لحظة
 *   التفعيل (تعديلها بعدها يُرحَّل فرقه).
 * - loans.approvedAt: وقت اعتماد القرض (به يُقيَّد تسليم مبلغه).
 */

export class AccountingModule1792182242807 implements MigrationInterface {
    name = 'AccountingModule1792182242807'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."accounts_type_enum" AS ENUM('asset', 'liability', 'equity', 'revenue', 'expense')`);
        await queryRunner.query(`CREATE TABLE "accounts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "code" character varying(20) NOT NULL, "name" character varying(150) NOT NULL, "nameEn" character varying(150), "type" "public"."accounts_type_enum" NOT NULL, "parentId" uuid, "isGroup" boolean NOT NULL DEFAULT false, "systemKey" character varying(40), "isActive" boolean NOT NULL DEFAULT true, "description" character varying(300), CONSTRAINT "PK_5a7a02c20412299d198e097a8fe" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_400028436681d655ad3cd56354" ON "accounts" ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_8e5f0c34ac946cd20d2fc0b8d2" ON "accounts" ("tenantId", "parentId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f3394e4bb91deb1807a15176f7" ON "accounts" ("tenantId", "systemKey") WHERE "systemKey" IS NOT NULL AND "deletedAt" IS NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_89bfb98e6753e528fa388dcd1f" ON "accounts" ("tenantId", "code") WHERE "deletedAt" IS NULL`);
        await queryRunner.query(`CREATE TABLE "journal_entries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "number" character varying(20) NOT NULL, "date" date NOT NULL, "documentDate" date, "description" character varying(500) NOT NULL, "sourceType" character varying(30) NOT NULL, "sourceId" uuid, "sourceEvent" character varying(60), "sourceRef" character varying(40), "total" numeric(18,3) NOT NULL DEFAULT '0', "reversalOfId" uuid, "reversedById" uuid, "createdById" uuid, CONSTRAINT "PK_a70368e64230434457c8d007ab3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8ddb19c8d608eda820581b1df7" ON "journal_entries" ("tenantId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_60cc73ce786ab9d135a5b1ab6f" ON "journal_entries" ("tenantId", "sourceType", "sourceId", "sourceEvent") WHERE "sourceId" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_80253494ebb7f16c5a086cdb30" ON "journal_entries" ("tenantId", "date") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0729f4b3a68edf04f9215264da" ON "journal_entries" ("tenantId", "number") `);
        await queryRunner.query(`CREATE TABLE "journal_lines" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "entryId" uuid NOT NULL, "lineOrder" integer NOT NULL DEFAULT '0', "accountId" uuid NOT NULL, "date" date NOT NULL, "debit" numeric(18,3) NOT NULL DEFAULT '0', "credit" numeric(18,3) NOT NULL DEFAULT '0', "description" character varying(300), "branchId" uuid, "partyType" character varying(20), "partyId" uuid, CONSTRAINT "PK_70cba2da4588cee8921f73ef136" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_500988f9309b9e8eb1e526158e" ON "journal_lines" ("entryId") `);
        await queryRunner.query(`CREATE INDEX "IDX_dd88621051ea7ac5c6ace903c8" ON "journal_lines" ("tenantId", "partyType", "partyId") `);
        await queryRunner.query(`CREATE INDEX "IDX_cf6018168fe19b2e0d7d8df99e" ON "journal_lines" ("tenantId", "accountId", "date") `);
        await queryRunner.query(`CREATE TABLE "accounting_settings" ("tenantId" uuid NOT NULL, "activatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "startDate" date NOT NULL, "lockDate" date, "chartCountry" character varying(2) NOT NULL, "receiptAccounts" jsonb NOT NULL DEFAULT '{}', "paymentAccounts" jsonb NOT NULL DEFAULT '{}', "lastSyncAt" TIMESTAMP WITH TIME ZONE, "activatedById" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_553962c4f8576afb562f6e17961" PRIMARY KEY ("tenantId"))`);
        await queryRunner.query(`CREATE TABLE "accounting_posting_errors" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "sourceType" character varying(30) NOT NULL, "sourceId" uuid NOT NULL, "sourceEvent" character varying(60) NOT NULL, "sourceRef" character varying(40), "message" character varying(500) NOT NULL, "attempts" integer NOT NULL DEFAULT '1', "firstSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a1c2741339f016393403d9749b3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_821aad7a3e559e73ecc34284a7" ON "accounting_posting_errors" ("tenantId", "sourceType", "sourceId", "sourceEvent") `);
        await queryRunner.query(`CREATE TABLE "accounting_skipped_sources" ("tenantId" uuid NOT NULL, "sourceType" character varying(30) NOT NULL, "sourceId" uuid NOT NULL, "sourceEvent" character varying(60) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_42ae89834120a823016fbe8e7f9" PRIMARY KEY ("tenantId", "sourceType", "sourceId", "sourceEvent"))`);
        await queryRunner.query(`CREATE TABLE "accounting_opening_baselines" ("tenantId" uuid NOT NULL, "partyType" character varying(20) NOT NULL, "partyId" uuid NOT NULL, "amount" numeric(18,3) NOT NULL DEFAULT '0', CONSTRAINT "PK_40f7a1174916dbf7d6bc631f08e" PRIMARY KEY ("tenantId", "partyType", "partyId"))`);
        await queryRunner.query(`ALTER TABLE "loans" ADD "approvedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "accounts" ADD CONSTRAINT "FK_400028436681d655ad3cd563540" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "accounts" ADD CONSTRAINT "FK_e1496dabea319842640e45fb3ed" FOREIGN KEY ("parentId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "journal_entries" ADD CONSTRAINT "FK_8ddb19c8d608eda820581b1df72" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "journal_lines" ADD CONSTRAINT "FK_500988f9309b9e8eb1e526158e4" FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "journal_lines" ADD CONSTRAINT "FK_d9eecc536593997a18359db2b47" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "journal_lines" DROP CONSTRAINT "FK_d9eecc536593997a18359db2b47"`);
        await queryRunner.query(`ALTER TABLE "journal_lines" DROP CONSTRAINT "FK_500988f9309b9e8eb1e526158e4"`);
        await queryRunner.query(`ALTER TABLE "journal_entries" DROP CONSTRAINT "FK_8ddb19c8d608eda820581b1df72"`);
        await queryRunner.query(`ALTER TABLE "accounts" DROP CONSTRAINT "FK_e1496dabea319842640e45fb3ed"`);
        await queryRunner.query(`ALTER TABLE "accounts" DROP CONSTRAINT "FK_400028436681d655ad3cd563540"`);
        await queryRunner.query(`ALTER TABLE "loans" DROP COLUMN "approvedAt"`);
        await queryRunner.query(`DROP TABLE "accounting_opening_baselines"`);
        await queryRunner.query(`DROP TABLE "accounting_skipped_sources"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_821aad7a3e559e73ecc34284a7"`);
        await queryRunner.query(`DROP TABLE "accounting_posting_errors"`);
        await queryRunner.query(`DROP TABLE "accounting_settings"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cf6018168fe19b2e0d7d8df99e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dd88621051ea7ac5c6ace903c8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_500988f9309b9e8eb1e526158e"`);
        await queryRunner.query(`DROP TABLE "journal_lines"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0729f4b3a68edf04f9215264da"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_80253494ebb7f16c5a086cdb30"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_60cc73ce786ab9d135a5b1ab6f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8ddb19c8d608eda820581b1df7"`);
        await queryRunner.query(`DROP TABLE "journal_entries"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_89bfb98e6753e528fa388dcd1f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f3394e4bb91deb1807a15176f7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8e5f0c34ac946cd20d2fc0b8d2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_400028436681d655ad3cd56354"`);
        await queryRunner.query(`DROP TABLE "accounts"`);
        await queryRunner.query(`DROP TYPE "public"."accounts_type_enum"`);
    }

}
