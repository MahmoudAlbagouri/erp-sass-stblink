import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePurchasing1791787652336 implements MigrationInterface {
    name = 'CreatePurchasing1791787652336'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "suppliers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "code" character varying(20) NOT NULL, "name" character varying NOT NULL, "contactPerson" character varying(120), "phone" character varying(30), "email" character varying(150), "taxNumber" character varying(20), "commercialRegister" character varying(20), "address" character varying(300), "paymentTermsDays" integer NOT NULL DEFAULT '0', "openingBalance" numeric(14,2) NOT NULL DEFAULT '0', "notes" character varying(500), "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_b70ac51766a9e3144f778cfe81e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_dd5cd678c4e94ddb93a224e711" ON "suppliers" ("tenantId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c793feacf345f73de5fd798d83" ON "suppliers" ("tenantId", "name") WHERE "deletedAt" IS NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_44f2eedae16aa3f04edd4f9e99" ON "suppliers" ("tenantId", "code") `);
        await queryRunner.query(`CREATE TYPE "public"."purchase_invoices_status_enum" AS ENUM('draft', 'posted', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "purchase_invoices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "number" character varying(20) NOT NULL, "supplierId" uuid NOT NULL, "warehouseId" uuid NOT NULL, "supplierReference" character varying(60), "invoiceDate" date NOT NULL, "dueDate" date, "status" "public"."purchase_invoices_status_enum" NOT NULL DEFAULT 'draft', "pricesIncludeTax" boolean NOT NULL DEFAULT false, "subtotal" numeric(14,2) NOT NULL DEFAULT '0', "discountTotal" numeric(14,2) NOT NULL DEFAULT '0', "taxTotal" numeric(14,2) NOT NULL DEFAULT '0', "total" numeric(14,2) NOT NULL DEFAULT '0', "paidAmount" numeric(14,2) NOT NULL DEFAULT '0', "returnedAmount" numeric(14,2) NOT NULL DEFAULT '0', "note" character varying(500), "createdById" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, "postedById" uuid, CONSTRAINT "PK_efa8a22a9bf7685952deba65c30" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_22e835548603fe545a70e86962" ON "purchase_invoices" ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_da5f6a099d43e105d21478a90d" ON "purchase_invoices" ("tenantId", "status", "invoiceDate") `);
        await queryRunner.query(`CREATE INDEX "IDX_1398c77f16891f0cef965721f7" ON "purchase_invoices" ("tenantId", "supplierId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0893fb418c2224df6aa1b71314" ON "purchase_invoices" ("tenantId", "number") `);
        await queryRunner.query(`CREATE TABLE "purchase_invoice_lines" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "invoiceId" uuid NOT NULL, "sortOrder" integer NOT NULL DEFAULT '0', "productId" uuid NOT NULL, "unitId" uuid NOT NULL, "factor" numeric(12,4) NOT NULL DEFAULT '1', "quantity" numeric(14,4) NOT NULL, "unitPrice" numeric(14,4) NOT NULL, "discount" numeric(14,2) NOT NULL DEFAULT '0', "taxRateId" uuid, "taxRate" numeric(5,2) NOT NULL DEFAULT '0', "subtotal" numeric(14,2) NOT NULL DEFAULT '0', "taxAmount" numeric(14,2) NOT NULL DEFAULT '0', "total" numeric(14,2) NOT NULL DEFAULT '0', "baseQuantity" numeric(14,4) NOT NULL, "unitCost" numeric(14,4) NOT NULL, "returnedQuantity" numeric(14,4) NOT NULL DEFAULT '0', CONSTRAINT "PK_0052805e432dca6a57d51f66f7a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ff420c61a0a388e44e711d0a3b" ON "purchase_invoice_lines" ("invoiceId") `);
        await queryRunner.query(`CREATE TYPE "public"."supplier_payments_method_enum" AS ENUM('cash', 'bank_transfer', 'card', 'cheque')`);
        await queryRunner.query(`CREATE TYPE "public"."supplier_payments_status_enum" AS ENUM('posted', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "supplier_payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "number" character varying(20) NOT NULL, "supplierId" uuid NOT NULL, "invoiceId" uuid, "paymentDate" date NOT NULL, "amount" numeric(14,2) NOT NULL, "method" "public"."supplier_payments_method_enum" NOT NULL DEFAULT 'cash', "reference" character varying(80), "note" character varying(500), "status" "public"."supplier_payments_status_enum" NOT NULL DEFAULT 'posted', "createdById" uuid, CONSTRAINT "PK_76e86f3194494faf999c652dbf9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_94835fbd85e4178a822bf65d8c" ON "supplier_payments" ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_889285e1e0ca8a57f4086a2643" ON "supplier_payments" ("tenantId", "invoiceId") `);
        await queryRunner.query(`CREATE INDEX "IDX_5d4ad5f2c3a2eb5bbae0b0e9c4" ON "supplier_payments" ("tenantId", "supplierId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9b60d2e390a608850a81a8940e" ON "supplier_payments" ("tenantId", "number") `);
        await queryRunner.query(`CREATE TYPE "public"."purchase_returns_status_enum" AS ENUM('draft', 'posted', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "purchase_returns" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "number" character varying(20) NOT NULL, "invoiceId" uuid NOT NULL, "supplierId" uuid NOT NULL, "warehouseId" uuid NOT NULL, "returnDate" date NOT NULL, "status" "public"."purchase_returns_status_enum" NOT NULL DEFAULT 'draft', "subtotal" numeric(14,2) NOT NULL DEFAULT '0', "taxTotal" numeric(14,2) NOT NULL DEFAULT '0', "total" numeric(14,2) NOT NULL DEFAULT '0', "reason" character varying(500), "createdById" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, "postedById" uuid, CONSTRAINT "PK_cc2ea54a32938fc38a4e5442330" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_04b0ed3436a7d8f34b1c581f27" ON "purchase_returns" ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_bde2b8f5a6db1379d3f497a294" ON "purchase_returns" ("tenantId", "invoiceId") `);
        await queryRunner.query(`CREATE INDEX "IDX_9c807dabc75f819fea8e5f587f" ON "purchase_returns" ("tenantId", "supplierId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f3b8a96bb3a0a69fdd38c55161" ON "purchase_returns" ("tenantId", "number") `);
        await queryRunner.query(`CREATE TABLE "purchase_return_lines" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "returnId" uuid NOT NULL, "invoiceLineId" uuid NOT NULL, "productId" uuid NOT NULL, "unitId" uuid NOT NULL, "quantity" numeric(14,4) NOT NULL, "baseQuantity" numeric(14,4) NOT NULL, "subtotal" numeric(14,2) NOT NULL DEFAULT '0', "taxAmount" numeric(14,2) NOT NULL DEFAULT '0', "total" numeric(14,2) NOT NULL DEFAULT '0', CONSTRAINT "PK_3b00e5c8755eb0b726033f1d8ef" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_cc0160918e286754adc03682d0" ON "purchase_return_lines" ("returnId", "invoiceLineId") `);
        await queryRunner.query(`ALTER TABLE "suppliers" ADD CONSTRAINT "FK_dd5cd678c4e94ddb93a224e7116" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "purchase_invoices" ADD CONSTRAINT "FK_22e835548603fe545a70e869628" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "purchase_invoices" ADD CONSTRAINT "FK_4f6a26a09f42a06f4ab7174238c" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "purchase_invoices" ADD CONSTRAINT "FK_c3a95df50a0347d775ece368270" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "FK_ff420c61a0a388e44e711d0a3b1" FOREIGN KEY ("invoiceId") REFERENCES "purchase_invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "FK_edc4abe3c7b64bc704e6bb261dc" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "purchase_invoice_lines" ADD CONSTRAINT "FK_937600eb972250e627d6532965b" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "supplier_payments" ADD CONSTRAINT "FK_94835fbd85e4178a822bf65d8c7" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "supplier_payments" ADD CONSTRAINT "FK_a9606c250851fd546b0669925a4" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "supplier_payments" ADD CONSTRAINT "FK_994fd37f958f698753fa42ab91b" FOREIGN KEY ("invoiceId") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "purchase_returns" ADD CONSTRAINT "FK_04b0ed3436a7d8f34b1c581f271" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "purchase_returns" ADD CONSTRAINT "FK_dc9c867d73f8a32dbc48085d20b" FOREIGN KEY ("invoiceId") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "purchase_returns" ADD CONSTRAINT "FK_aa8b739c9ec5c7ad25d7e5c0471" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "purchase_returns" ADD CONSTRAINT "FK_162a544a428b11eb7cd67202503" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "FK_5db45ccdf2ea578edf4c2ec8c01" FOREIGN KEY ("returnId") REFERENCES "purchase_returns"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "FK_de069c18d5e82805dd99c79af29" FOREIGN KEY ("invoiceLineId") REFERENCES "purchase_invoice_lines"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "FK_3b683fafb5fcdfd2b3f5b951ca3" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "FK_45cab9479d0d2249675a9182bd3" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "purchase_return_lines" DROP CONSTRAINT "FK_45cab9479d0d2249675a9182bd3"`);
        await queryRunner.query(`ALTER TABLE "purchase_return_lines" DROP CONSTRAINT "FK_3b683fafb5fcdfd2b3f5b951ca3"`);
        await queryRunner.query(`ALTER TABLE "purchase_return_lines" DROP CONSTRAINT "FK_de069c18d5e82805dd99c79af29"`);
        await queryRunner.query(`ALTER TABLE "purchase_return_lines" DROP CONSTRAINT "FK_5db45ccdf2ea578edf4c2ec8c01"`);
        await queryRunner.query(`ALTER TABLE "purchase_returns" DROP CONSTRAINT "FK_162a544a428b11eb7cd67202503"`);
        await queryRunner.query(`ALTER TABLE "purchase_returns" DROP CONSTRAINT "FK_aa8b739c9ec5c7ad25d7e5c0471"`);
        await queryRunner.query(`ALTER TABLE "purchase_returns" DROP CONSTRAINT "FK_dc9c867d73f8a32dbc48085d20b"`);
        await queryRunner.query(`ALTER TABLE "purchase_returns" DROP CONSTRAINT "FK_04b0ed3436a7d8f34b1c581f271"`);
        await queryRunner.query(`ALTER TABLE "supplier_payments" DROP CONSTRAINT "FK_994fd37f958f698753fa42ab91b"`);
        await queryRunner.query(`ALTER TABLE "supplier_payments" DROP CONSTRAINT "FK_a9606c250851fd546b0669925a4"`);
        await queryRunner.query(`ALTER TABLE "supplier_payments" DROP CONSTRAINT "FK_94835fbd85e4178a822bf65d8c7"`);
        await queryRunner.query(`ALTER TABLE "purchase_invoice_lines" DROP CONSTRAINT "FK_937600eb972250e627d6532965b"`);
        await queryRunner.query(`ALTER TABLE "purchase_invoice_lines" DROP CONSTRAINT "FK_edc4abe3c7b64bc704e6bb261dc"`);
        await queryRunner.query(`ALTER TABLE "purchase_invoice_lines" DROP CONSTRAINT "FK_ff420c61a0a388e44e711d0a3b1"`);
        await queryRunner.query(`ALTER TABLE "purchase_invoices" DROP CONSTRAINT "FK_c3a95df50a0347d775ece368270"`);
        await queryRunner.query(`ALTER TABLE "purchase_invoices" DROP CONSTRAINT "FK_4f6a26a09f42a06f4ab7174238c"`);
        await queryRunner.query(`ALTER TABLE "purchase_invoices" DROP CONSTRAINT "FK_22e835548603fe545a70e869628"`);
        await queryRunner.query(`ALTER TABLE "suppliers" DROP CONSTRAINT "FK_dd5cd678c4e94ddb93a224e7116"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cc0160918e286754adc03682d0"`);
        await queryRunner.query(`DROP TABLE "purchase_return_lines"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f3b8a96bb3a0a69fdd38c55161"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9c807dabc75f819fea8e5f587f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bde2b8f5a6db1379d3f497a294"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_04b0ed3436a7d8f34b1c581f27"`);
        await queryRunner.query(`DROP TABLE "purchase_returns"`);
        await queryRunner.query(`DROP TYPE "public"."purchase_returns_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9b60d2e390a608850a81a8940e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5d4ad5f2c3a2eb5bbae0b0e9c4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_889285e1e0ca8a57f4086a2643"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_94835fbd85e4178a822bf65d8c"`);
        await queryRunner.query(`DROP TABLE "supplier_payments"`);
        await queryRunner.query(`DROP TYPE "public"."supplier_payments_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."supplier_payments_method_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ff420c61a0a388e44e711d0a3b"`);
        await queryRunner.query(`DROP TABLE "purchase_invoice_lines"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0893fb418c2224df6aa1b71314"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1398c77f16891f0cef965721f7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_da5f6a099d43e105d21478a90d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_22e835548603fe545a70e86962"`);
        await queryRunner.query(`DROP TABLE "purchase_invoices"`);
        await queryRunner.query(`DROP TYPE "public"."purchase_invoices_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_44f2eedae16aa3f04edd4f9e99"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c793feacf345f73de5fd798d83"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dd5cd678c4e94ddb93a224e711"`);
        await queryRunner.query(`DROP TABLE "suppliers"`);
    }

}
