// عروض أسعار العملاء من شاشة الكاشير: مستند معلومات لا يمس المخزون ولا الفواتير،
// فله جدوله (غير جدول quotations الخاص بمالك النظام)، وللجهاز عدّاد مستقل يبقى
// بعد إعادة تهيئته فلا تتكرر أرقام عروضه.
import { MigrationInterface, QueryRunner } from "typeorm";

export class SalesQuotes1793500000000 implements MigrationInterface {
    name = 'SalesQuotes1793500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."sales_quotes_status_enum" AS ENUM('open', 'converted', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "sales_quotes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "uuid" uuid NOT NULL, "number" character varying(30) NOT NULL, "status" "public"."sales_quotes_status_enum" NOT NULL DEFAULT 'open', "customerId" uuid, "customerName" character varying(200), "customerPhone" character varying(30), "customerTaxNumber" character varying(20), "warehouseId" uuid NOT NULL, "deviceId" uuid, "shiftId" uuid, "cashierName" character varying(150), "approvedBy" character varying(150), "createdById" uuid, "issuedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "validUntil" date NOT NULL, "pricesIncludeTax" boolean NOT NULL DEFAULT true, "lines" jsonb NOT NULL, "subtotal" numeric(15,3) NOT NULL DEFAULT '0', "discountTotal" numeric(15,3) NOT NULL DEFAULT '0', "taxTotal" numeric(15,3) NOT NULL DEFAULT '0', "total" numeric(15,3) NOT NULL DEFAULT '0', "note" character varying(500), "convertedInvoiceId" uuid, "convertedInvoiceNumber" character varying(30), "convertedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_53ddff559487a9ba80be5e0e2ea" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_81f0636325f7cf637c68258c49" ON "sales_quotes" ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_b69ca1c231d1ab98858e986315" ON "sales_quotes" ("tenantId", "status", "issuedAt") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_fd518a372b97b96b7ccdaca395" ON "sales_quotes" ("tenantId", "number") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_b29080ccd8e3ad36d84a78ff62" ON "sales_quotes" ("tenantId", "uuid") `);
        await queryRunner.query(`ALTER TABLE "pos_devices" ADD "lastQuoteCounter" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "sales_quotes" ADD CONSTRAINT "FK_81f0636325f7cf637c68258c495" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sales_quotes" ADD CONSTRAINT "FK_f4e993f1d3feac8f45ab76ab8e9" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "sales_quotes" DROP CONSTRAINT "FK_f4e993f1d3feac8f45ab76ab8e9"`);
        await queryRunner.query(`ALTER TABLE "sales_quotes" DROP CONSTRAINT "FK_81f0636325f7cf637c68258c495"`);
        await queryRunner.query(`ALTER TABLE "pos_devices" DROP COLUMN "lastQuoteCounter"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b29080ccd8e3ad36d84a78ff62"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fd518a372b97b96b7ccdaca395"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b69ca1c231d1ab98858e986315"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_81f0636325f7cf637c68258c49"`);
        await queryRunner.query(`DROP TABLE "sales_quotes"`);
        await queryRunner.query(`DROP TYPE "public"."sales_quotes_status_enum"`);
    }

}
