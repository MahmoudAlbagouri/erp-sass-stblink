import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * التوصيل والشحن:
 *
 * - delivery_agents: الطيارون وشركات الشحن (أجرة/رسوم كل أوردر ونسبة التحصيل).
 * - delivery_zones: مناطق التوصيل ورسومها على العميل ووقتها المتوقع.
 * - delivery_orders: الأوردرات؛ لكل أوردر فاتورة بيع (invoiceId فريد).
 * - delivery_settlements: تسويات الجهات (المحصّل − الرسوم مقابل المستلم).
 * - sales_invoices.isDelivery: فاتورة أوردر توصيل تُدار من شاشة التوصيل وحدها.
 * - customer_payments.method += 'courier': تحصيل عند التسليم عبر جهة توصيل.
 */

export class Delivery1791913000000 implements MigrationInterface {
  name = 'Delivery1791913000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."delivery_agents_type_enum" AS ENUM('driver', 'carrier')`,
    );
    await queryRunner.query(
      `CREATE TABLE "delivery_agents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "type" "public"."delivery_agents_type_enum" NOT NULL, "name" character varying(150) NOT NULL, "phone" character varying(30), "defaultFee" numeric(15,3) NOT NULL DEFAULT '0', "codFeePercent" numeric(5,2) NOT NULL DEFAULT '0', "isActive" boolean NOT NULL DEFAULT true, "note" character varying(300), CONSTRAINT "PK_a7c2106d5b7261ca0afd794366c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_effb0ff3544df1ba364adfd95c" ON "delivery_agents" ("tenantId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_930dae5374078daf47145cfa13" ON "delivery_agents" ("tenantId", "name") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "delivery_zones" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "name" character varying(120) NOT NULL, "fee" numeric(15,3) NOT NULL DEFAULT '0', "estimatedMinutes" integer, "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_88bc4c12be62436a61930cf34a9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_733a965465438a401dd3a5a9cb" ON "delivery_zones" ("tenantId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a3500d4324fb615ef6d8029bdc" ON "delivery_zones" ("tenantId", "name") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."delivery_orders_status_enum" AS ENUM('new', 'assigned', 'out_for_delivery', 'delivered', 'failed', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."delivery_orders_paymentmode_enum" AS ENUM('cod', 'prepaid')`,
    );
    await queryRunner.query(
      `CREATE TABLE "delivery_orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "number" character varying(30) NOT NULL, "invoiceId" uuid NOT NULL, "warehouseId" uuid NOT NULL, "customerId" uuid, "recipientName" character varying(150) NOT NULL, "phone" character varying(30) NOT NULL, "address" character varying(500) NOT NULL, "zoneId" uuid, "agentId" uuid, "status" "public"."delivery_orders_status_enum" NOT NULL DEFAULT 'new', "paymentMode" "public"."delivery_orders_paymentmode_enum" NOT NULL, "prepaidMethod" character varying(20), "codAmount" numeric(15,3) NOT NULL DEFAULT '0', "deliveryFee" numeric(15,3) NOT NULL DEFAULT '0', "agentFee" numeric(15,3) NOT NULL DEFAULT '0', "trackingNumber" character varying(80), "note" character varying(500), "failReason" character varying(300), "returnId" uuid, "assignedAt" TIMESTAMP WITH TIME ZONE, "dispatchedAt" TIMESTAMP WITH TIME ZONE, "deliveredAt" TIMESTAMP WITH TIME ZONE, "failedAt" TIMESTAMP WITH TIME ZONE, "cancelledAt" TIMESTAMP WITH TIME ZONE, "settlementId" uuid, "createdById" uuid, CONSTRAINT "PK_29e637736a0b5f36946edec3650" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_89cd418d19f2842340a6bb69de" ON "delivery_orders" ("tenantId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ffa67dd56426be045e02e5b881" ON "delivery_orders" ("invoiceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f49f185b7a04c3447fff1844f7" ON "delivery_orders" ("tenantId", "agentId", "settlementId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_80b866124285da5e6caa6bce77" ON "delivery_orders" ("tenantId", "status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_6543ce16635680ca117d399b11" ON "delivery_orders" ("tenantId", "number") `,
    );
    await queryRunner.query(
      `CREATE TABLE "delivery_settlements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "number" character varying(30) NOT NULL, "agentId" uuid NOT NULL, "settledAt" TIMESTAMP WITH TIME ZONE NOT NULL, "ordersCount" integer NOT NULL DEFAULT '0', "collectedTotal" numeric(15,3) NOT NULL DEFAULT '0', "feesTotal" numeric(15,3) NOT NULL DEFAULT '0', "expectedAmount" numeric(15,3) NOT NULL DEFAULT '0', "receivedAmount" numeric(15,3) NOT NULL DEFAULT '0', "difference" numeric(15,3) NOT NULL DEFAULT '0', "method" character varying(20) NOT NULL, "note" character varying(500), "createdById" uuid, CONSTRAINT "PK_8d652a4ca71a62127b8c0b015fa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e5d8698f703fd2d02c2008bea2" ON "delivery_settlements" ("tenantId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c2d5bfb4951f556ea5c64ab60d" ON "delivery_settlements" ("tenantId", "agentId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_47e2c4064fddd07e881efe4a15" ON "delivery_settlements" ("tenantId", "number") `,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_invoices" ADD "isDelivery" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."customer_payments_method_enum" RENAME TO "customer_payments_method_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."customer_payments_method_enum" AS ENUM('cash', 'card', 'bank_transfer', 'cheque', 'courier')`,
    );
    await queryRunner.query(
      `ALTER TABLE "customer_payments" ALTER COLUMN "method" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "customer_payments" ALTER COLUMN "method" TYPE "public"."customer_payments_method_enum" USING "method"::"text"::"public"."customer_payments_method_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customer_payments" ALTER COLUMN "method" SET DEFAULT 'cash'`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."customer_payments_method_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_agents" ADD CONSTRAINT "FK_effb0ff3544df1ba364adfd95ca" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_zones" ADD CONSTRAINT "FK_733a965465438a401dd3a5a9cb6" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" ADD CONSTRAINT "FK_89cd418d19f2842340a6bb69de4" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" ADD CONSTRAINT "FK_ffa67dd56426be045e02e5b881d" FOREIGN KEY ("invoiceId") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" ADD CONSTRAINT "FK_6c9fc107216eabec3fcf63e6354" FOREIGN KEY ("zoneId") REFERENCES "delivery_zones"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" ADD CONSTRAINT "FK_5c86bbe48595cb3f2160e2f4937" FOREIGN KEY ("agentId") REFERENCES "delivery_agents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_settlements" ADD CONSTRAINT "FK_e5d8698f703fd2d02c2008bea28" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_settlements" ADD CONSTRAINT "FK_a6af4bc6e170c0b9e76323bba2e" FOREIGN KEY ("agentId") REFERENCES "delivery_agents"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_settlements" DROP CONSTRAINT "FK_a6af4bc6e170c0b9e76323bba2e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_settlements" DROP CONSTRAINT "FK_e5d8698f703fd2d02c2008bea28"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" DROP CONSTRAINT "FK_5c86bbe48595cb3f2160e2f4937"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" DROP CONSTRAINT "FK_6c9fc107216eabec3fcf63e6354"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" DROP CONSTRAINT "FK_ffa67dd56426be045e02e5b881d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_orders" DROP CONSTRAINT "FK_89cd418d19f2842340a6bb69de4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_zones" DROP CONSTRAINT "FK_733a965465438a401dd3a5a9cb6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_agents" DROP CONSTRAINT "FK_effb0ff3544df1ba364adfd95ca"`,
    );
    // لا مكان لـ courier في النوع القديم: تُعامل كنقدي
    await queryRunner.query(
      `UPDATE "customer_payments" SET "method" = 'cash' WHERE "method" = 'courier'`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."customer_payments_method_enum_old" AS ENUM('cash', 'card', 'bank_transfer', 'cheque')`,
    );
    await queryRunner.query(
      `ALTER TABLE "customer_payments" ALTER COLUMN "method" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "customer_payments" ALTER COLUMN "method" TYPE "public"."customer_payments_method_enum_old" USING "method"::"text"::"public"."customer_payments_method_enum_old"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customer_payments" ALTER COLUMN "method" SET DEFAULT 'cash'`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."customer_payments_method_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."customer_payments_method_enum_old" RENAME TO "customer_payments_method_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_invoices" DROP COLUMN "isDelivery"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_47e2c4064fddd07e881efe4a15"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c2d5bfb4951f556ea5c64ab60d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e5d8698f703fd2d02c2008bea2"`,
    );
    await queryRunner.query(`DROP TABLE "delivery_settlements"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6543ce16635680ca117d399b11"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_80b866124285da5e6caa6bce77"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f49f185b7a04c3447fff1844f7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ffa67dd56426be045e02e5b881"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_89cd418d19f2842340a6bb69de"`,
    );
    await queryRunner.query(`DROP TABLE "delivery_orders"`);
    await queryRunner.query(
      `DROP TYPE "public"."delivery_orders_paymentmode_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."delivery_orders_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a3500d4324fb615ef6d8029bdc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_733a965465438a401dd3a5a9cb"`,
    );
    await queryRunner.query(`DROP TABLE "delivery_zones"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_930dae5374078daf47145cfa13"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_effb0ff3544df1ba364adfd95c"`,
    );
    await queryRunner.query(`DROP TABLE "delivery_agents"`);
    await queryRunner.query(`DROP TYPE "public"."delivery_agents_type_enum"`);
  }
}
