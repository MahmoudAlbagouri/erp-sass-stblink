import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSales1791789513054 implements MigrationInterface {
    name = 'CreateSales1791789513054'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "sales_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "sellerName" character varying(200), "taxNumber" character varying(20), "commercialRegister" character varying(20), "address" character varying(300), "phone" character varying(30), "invoiceFooter" character varying(300), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e6867c5637fa92037149f8044f5" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a7a8772f3668bfb7bb57c74b02" ON "sales_settings" ("tenantId") `);
        await queryRunner.query(`CREATE TABLE "customers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "code" character varying(20) NOT NULL, "name" character varying NOT NULL, "phone" character varying(30), "email" character varying(150), "taxNumber" character varying(20), "commercialRegister" character varying(20), "address" character varying(300), "paymentTermsDays" integer NOT NULL DEFAULT '0', "creditLimit" numeric(14,2), "openingBalance" numeric(14,2) NOT NULL DEFAULT '0', "notes" character varying(500), "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_133ec679a801fab5e070f73d3ea" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_37c1a605468d156e6a8f78f1dc" ON "customers" ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_9d65828f9dab00ed0f73bf0c85" ON "customers" ("tenantId", "updatedAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_f5a6dc89260d490a94bc78adff" ON "customers" ("tenantId", "name") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_7f5d38775dbe1b3983b871b72e" ON "customers" ("tenantId", "code") `);
        await queryRunner.query(`CREATE TYPE "public"."sales_invoices_invoicetype_enum" AS ENUM('simplified', 'standard')`);
        await queryRunner.query(`CREATE TYPE "public"."sales_invoices_status_enum" AS ENUM('draft', 'issued', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "sales_invoices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "uuid" uuid NOT NULL, "number" character varying(30), "invoiceType" "public"."sales_invoices_invoicetype_enum" NOT NULL DEFAULT 'simplified', "customerId" uuid, "warehouseId" uuid NOT NULL, "invoiceDate" date NOT NULL, "dueDate" date, "status" "public"."sales_invoices_status_enum" NOT NULL DEFAULT 'draft', "pricesIncludeTax" boolean NOT NULL DEFAULT true, "subtotal" numeric(14,2) NOT NULL DEFAULT '0', "discountTotal" numeric(14,2) NOT NULL DEFAULT '0', "taxTotal" numeric(14,2) NOT NULL DEFAULT '0', "total" numeric(14,2) NOT NULL DEFAULT '0', "paidAmount" numeric(14,2) NOT NULL DEFAULT '0', "returnedAmount" numeric(14,2) NOT NULL DEFAULT '0', "costTotal" numeric(14,2) NOT NULL DEFAULT '0', "note" character varying(500), "createdById" uuid, "issuedAt" TIMESTAMP WITH TIME ZONE, "issuedById" uuid, "qrCode" text, "counter" integer, "invoiceHash" character varying(64), "previousInvoiceHash" character varying(64), "deviceId" uuid, CONSTRAINT "PK_be0576afbf66c353a8a4435a45b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_faa92ecb55ff5bebf529a5e4b0" ON "sales_invoices" ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_6290af429b25f1f2296d8d8066" ON "sales_invoices" ("tenantId", "status", "issuedAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_313d7c8fca8fc4bfa33159f881" ON "sales_invoices" ("tenantId", "customerId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_362d9f896c7e87d0a11663ac26" ON "sales_invoices" ("tenantId", "uuid") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_6076fc637e4d05ea15bc4092de" ON "sales_invoices" ("tenantId", "number") WHERE "number" IS NOT NULL`);
        await queryRunner.query(`CREATE TABLE "sales_invoice_lines" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "invoiceId" uuid NOT NULL, "sortOrder" integer NOT NULL DEFAULT '0', "productId" uuid NOT NULL, "productName" character varying NOT NULL, "sku" character varying(60) NOT NULL, "isStocked" boolean NOT NULL DEFAULT true, "unitId" uuid NOT NULL, "unitName" character varying(60) NOT NULL, "factor" numeric(12,4) NOT NULL DEFAULT '1', "quantity" numeric(14,4) NOT NULL, "unitPrice" numeric(14,4) NOT NULL, "discount" numeric(14,2) NOT NULL DEFAULT '0', "taxRate" numeric(5,2) NOT NULL DEFAULT '0', "taxCategory" character varying(1) NOT NULL DEFAULT 'S', "subtotal" numeric(14,2) NOT NULL DEFAULT '0', "taxAmount" numeric(14,2) NOT NULL DEFAULT '0', "total" numeric(14,2) NOT NULL DEFAULT '0', "baseQuantity" numeric(14,4) NOT NULL, "unitCost" numeric(14,4) NOT NULL DEFAULT '0', "returnedQuantity" numeric(14,4) NOT NULL DEFAULT '0', CONSTRAINT "PK_aeb2029d20ce3a41df372ebd255" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1e9ff62650b3245f1cbb668bd2" ON "sales_invoice_lines" ("invoiceId") `);
        await queryRunner.query(`CREATE TYPE "public"."sales_returns_status_enum" AS ENUM('draft', 'issued', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "sales_returns" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "number" character varying(30), "invoiceId" uuid NOT NULL, "customerId" uuid, "warehouseId" uuid NOT NULL, "returnDate" date NOT NULL, "status" "public"."sales_returns_status_enum" NOT NULL DEFAULT 'draft', "subtotal" numeric(14,2) NOT NULL DEFAULT '0', "taxTotal" numeric(14,2) NOT NULL DEFAULT '0', "total" numeric(14,2) NOT NULL DEFAULT '0', "refundedAmount" numeric(14,2) NOT NULL DEFAULT '0', "reason" character varying(500), "createdById" uuid, "issuedAt" TIMESTAMP WITH TIME ZONE, "issuedById" uuid, CONSTRAINT "PK_7910eebccdade339a4e49fb002f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a9eb7c029327218f3e045d7cd1" ON "sales_returns" ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_358d35206307012e8a67b7097e" ON "sales_returns" ("tenantId", "invoiceId") `);
        await queryRunner.query(`CREATE INDEX "IDX_f4b3fff138400d1d4fb275ab83" ON "sales_returns" ("tenantId", "customerId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a55cd624d06c1abe544c30ceed" ON "sales_returns" ("tenantId", "number") WHERE "number" IS NOT NULL`);
        await queryRunner.query(`CREATE TABLE "sales_return_lines" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "returnId" uuid NOT NULL, "invoiceLineId" uuid NOT NULL, "productId" uuid NOT NULL, "productName" character varying NOT NULL, "unitName" character varying(60) NOT NULL, "quantity" numeric(14,4) NOT NULL, "baseQuantity" numeric(14,4) NOT NULL, "subtotal" numeric(14,2) NOT NULL DEFAULT '0', "taxAmount" numeric(14,2) NOT NULL DEFAULT '0', "total" numeric(14,2) NOT NULL DEFAULT '0', CONSTRAINT "PK_bb9e5847c318e2783fc0dabf7b7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_68c1379037a64f4fa69415e8fd" ON "sales_return_lines" ("returnId", "invoiceLineId") `);
        await queryRunner.query(`CREATE TYPE "public"."customer_payments_direction_enum" AS ENUM('in', 'out')`);
        await queryRunner.query(`CREATE TYPE "public"."customer_payments_method_enum" AS ENUM('cash', 'card', 'bank_transfer', 'cheque')`);
        await queryRunner.query(`CREATE TYPE "public"."customer_payments_status_enum" AS ENUM('posted', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "customer_payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "number" character varying(20) NOT NULL, "customerId" uuid, "invoiceId" uuid, "salesReturnId" uuid, "direction" "public"."customer_payments_direction_enum" NOT NULL DEFAULT 'in', "paymentDate" date NOT NULL, "amount" numeric(14,2) NOT NULL, "method" "public"."customer_payments_method_enum" NOT NULL DEFAULT 'cash', "reference" character varying(80), "note" character varying(500), "status" "public"."customer_payments_status_enum" NOT NULL DEFAULT 'posted', "createdById" uuid, CONSTRAINT "PK_49f9fc4bd44d957db20148928d1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_03ff5c5afe2916600dc9194682" ON "customer_payments" ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_f4c429575b32082c57b2809426" ON "customer_payments" ("tenantId", "paymentDate") `);
        await queryRunner.query(`CREATE INDEX "IDX_0e152caf3441c8437d2e621e71" ON "customer_payments" ("tenantId", "invoiceId") `);
        await queryRunner.query(`CREATE INDEX "IDX_8449a3f0209de4e83d17bb772f" ON "customer_payments" ("tenantId", "customerId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_8e8a540cc3fed34deaba2d5c0b" ON "customer_payments" ("tenantId", "number") `);
        await queryRunner.query(`ALTER TABLE "customers" ADD CONSTRAINT "FK_37c1a605468d156e6a8f78f1dc5" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" ADD CONSTRAINT "FK_faa92ecb55ff5bebf529a5e4b08" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" ADD CONSTRAINT "FK_a6c1cffd5c82f7e41f7ec95ab43" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" ADD CONSTRAINT "FK_b087fc72c49de60fac66b9ad0d7" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "FK_1e9ff62650b3245f1cbb668bd27" FOREIGN KEY ("invoiceId") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "FK_be32733f32e01ecbdc988ca4d86" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "FK_661ba5f40a7705efe88f23372b4" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sales_returns" ADD CONSTRAINT "FK_a9eb7c029327218f3e045d7cd17" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sales_returns" ADD CONSTRAINT "FK_1b15b03e110e350b14c9a086599" FOREIGN KEY ("invoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sales_returns" ADD CONSTRAINT "FK_923abe9769efff15d475733beeb" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sales_returns" ADD CONSTRAINT "FK_c0aaf9974d871de328d6e0a7e98" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sales_return_lines" ADD CONSTRAINT "FK_bc937474ba7706a9775425c9995" FOREIGN KEY ("returnId") REFERENCES "sales_returns"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sales_return_lines" ADD CONSTRAINT "FK_146fd0ecba8d4bdc8910df2efc5" FOREIGN KEY ("invoiceLineId") REFERENCES "sales_invoice_lines"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sales_return_lines" ADD CONSTRAINT "FK_52f81701578d2d901fcbf7436bb" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "customer_payments" ADD CONSTRAINT "FK_03ff5c5afe2916600dc91946827" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "customer_payments" ADD CONSTRAINT "FK_ff937f82f18ea0f86fb528fb6ad" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "customer_payments" ADD CONSTRAINT "FK_6a54c396894dee5a6a231e7949c" FOREIGN KEY ("invoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "customer_payments" DROP CONSTRAINT "FK_6a54c396894dee5a6a231e7949c"`);
        await queryRunner.query(`ALTER TABLE "customer_payments" DROP CONSTRAINT "FK_ff937f82f18ea0f86fb528fb6ad"`);
        await queryRunner.query(`ALTER TABLE "customer_payments" DROP CONSTRAINT "FK_03ff5c5afe2916600dc91946827"`);
        await queryRunner.query(`ALTER TABLE "sales_return_lines" DROP CONSTRAINT "FK_52f81701578d2d901fcbf7436bb"`);
        await queryRunner.query(`ALTER TABLE "sales_return_lines" DROP CONSTRAINT "FK_146fd0ecba8d4bdc8910df2efc5"`);
        await queryRunner.query(`ALTER TABLE "sales_return_lines" DROP CONSTRAINT "FK_bc937474ba7706a9775425c9995"`);
        await queryRunner.query(`ALTER TABLE "sales_returns" DROP CONSTRAINT "FK_c0aaf9974d871de328d6e0a7e98"`);
        await queryRunner.query(`ALTER TABLE "sales_returns" DROP CONSTRAINT "FK_923abe9769efff15d475733beeb"`);
        await queryRunner.query(`ALTER TABLE "sales_returns" DROP CONSTRAINT "FK_1b15b03e110e350b14c9a086599"`);
        await queryRunner.query(`ALTER TABLE "sales_returns" DROP CONSTRAINT "FK_a9eb7c029327218f3e045d7cd17"`);
        await queryRunner.query(`ALTER TABLE "sales_invoice_lines" DROP CONSTRAINT "FK_661ba5f40a7705efe88f23372b4"`);
        await queryRunner.query(`ALTER TABLE "sales_invoice_lines" DROP CONSTRAINT "FK_be32733f32e01ecbdc988ca4d86"`);
        await queryRunner.query(`ALTER TABLE "sales_invoice_lines" DROP CONSTRAINT "FK_1e9ff62650b3245f1cbb668bd27"`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" DROP CONSTRAINT "FK_b087fc72c49de60fac66b9ad0d7"`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" DROP CONSTRAINT "FK_a6c1cffd5c82f7e41f7ec95ab43"`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" DROP CONSTRAINT "FK_faa92ecb55ff5bebf529a5e4b08"`);
        await queryRunner.query(`ALTER TABLE "customers" DROP CONSTRAINT "FK_37c1a605468d156e6a8f78f1dc5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8e8a540cc3fed34deaba2d5c0b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_8449a3f0209de4e83d17bb772f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0e152caf3441c8437d2e621e71"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f4c429575b32082c57b2809426"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_03ff5c5afe2916600dc9194682"`);
        await queryRunner.query(`DROP TABLE "customer_payments"`);
        await queryRunner.query(`DROP TYPE "public"."customer_payments_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."customer_payments_method_enum"`);
        await queryRunner.query(`DROP TYPE "public"."customer_payments_direction_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_68c1379037a64f4fa69415e8fd"`);
        await queryRunner.query(`DROP TABLE "sales_return_lines"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a55cd624d06c1abe544c30ceed"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f4b3fff138400d1d4fb275ab83"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_358d35206307012e8a67b7097e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a9eb7c029327218f3e045d7cd1"`);
        await queryRunner.query(`DROP TABLE "sales_returns"`);
        await queryRunner.query(`DROP TYPE "public"."sales_returns_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1e9ff62650b3245f1cbb668bd2"`);
        await queryRunner.query(`DROP TABLE "sales_invoice_lines"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6076fc637e4d05ea15bc4092de"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_362d9f896c7e87d0a11663ac26"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_313d7c8fca8fc4bfa33159f881"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6290af429b25f1f2296d8d8066"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_faa92ecb55ff5bebf529a5e4b0"`);
        await queryRunner.query(`DROP TABLE "sales_invoices"`);
        await queryRunner.query(`DROP TYPE "public"."sales_invoices_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."sales_invoices_invoicetype_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7f5d38775dbe1b3983b871b72e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f5a6dc89260d490a94bc78adff"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9d65828f9dab00ed0f73bf0c85"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_37c1a605468d156e6a8f78f1dc"`);
        await queryRunner.query(`DROP TABLE "customers"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a7a8772f3668bfb7bb57c74b02"`);
        await queryRunner.query(`DROP TABLE "sales_settings"`);
    }

}
