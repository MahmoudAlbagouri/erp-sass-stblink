import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * تحسينات الكاشير: حركات الدرج النقدية، سجل التدقيق، العروض والأسعار الخاصة،
 * المشرف وحد الخصم للكاشير، البيع الآجل من الكاشير، وإعدادات باركود الميزان.
 *
 * ترحيل البيانات: سندات القبض على فواتير الكاشير السابقة تأخذ ورديتها (كانت
 * كلها مقبوضة عند البيع)، فيبقى حساب درج الورديات القديمة كما هو.
 */
export class PosEnhancements1791912500000 implements MigrationInterface {
  name = 'PosEnhancements1791912500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."pos_cash_movements_type_enum" AS ENUM('in', 'out')`,
    );
    await queryRunner.query(
      `CREATE TABLE "pos_cash_movements" ("id" uuid NOT NULL, "tenantId" uuid NOT NULL, "deviceId" uuid NOT NULL, "shiftId" uuid NOT NULL, "type" "public"."pos_cash_movements_type_enum" NOT NULL, "amount" numeric(15,3) NOT NULL, "reason" character varying(300) NOT NULL, "cashierName" character varying(150), "approvedBy" character varying(150), "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_73fdfc5eb5c5726b7adf1a8fa25" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3357e04d91063ac937868b6902" ON "pos_cash_movements" ("tenantId", "shiftId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "pos_audit_logs" ("id" uuid NOT NULL, "tenantId" uuid NOT NULL, "deviceId" uuid NOT NULL, "shiftId" uuid, "action" character varying(40) NOT NULL, "cashierName" character varying(150), "approvedBy" character varying(150), "amount" numeric(15,3), "details" character varying(500), "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8cbfc315831828c557a82771eca" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c30c1263a24b651bf6d915b9d7" ON "pos_audit_logs" ("tenantId", "shiftId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a378ac6feeafbfb3eb1486f516" ON "pos_audit_logs" ("tenantId", "occurredAt") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pos_promotions_type_enum" AS ENUM('special_price', 'percent_off', 'buy_x_get_y')`,
    );
    await queryRunner.query(
      `CREATE TABLE "pos_promotions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "name" character varying(150) NOT NULL, "type" "public"."pos_promotions_type_enum" NOT NULL, "productId" uuid, "categoryId" uuid, "customerId" uuid, "price" numeric(15,3), "percent" numeric(5,2), "buyQuantity" integer, "getQuantity" integer, "startsAt" TIMESTAMP WITH TIME ZONE, "endsAt" TIMESTAMP WITH TIME ZONE, "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_1ac39db7e0ac810e623493b2cab" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e4ec567cfb7c008817efe2c976" ON "pos_promotions" ("tenantId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_36d676710f35a03e03e125fc2f" ON "pos_promotions" ("tenantId", "updatedAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_settings" ADD "posOptions" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "customer_payments" ADD "shiftId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_cashiers" ADD "isSupervisor" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_cashiers" ADD "maxDiscountPercent" numeric(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_shifts" ADD "creditTotal" numeric(15,3) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_shifts" ADD "cashIn" numeric(15,3) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_shifts" ADD "cashOut" numeric(15,3) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_af0aea868857e81141311e6344" ON "customer_payments" ("shiftId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_promotions" ADD CONSTRAINT "FK_e4ec567cfb7c008817efe2c976d" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // ─── ترحيل البيانات ───
    await queryRunner.query(
      `UPDATE "customer_payments" payment SET "shiftId" = invoice."shiftId"
         FROM "sales_invoices" invoice
        WHERE invoice."id" = payment."invoiceId" AND invoice."shiftId" IS NOT NULL
          AND payment."direction" = 'in' AND payment."salesReturnId" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pos_promotions" DROP CONSTRAINT "FK_e4ec567cfb7c008817efe2c976d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_af0aea868857e81141311e6344"`,
    );
    await queryRunner.query(`ALTER TABLE "pos_shifts" DROP COLUMN "cashOut"`);
    await queryRunner.query(`ALTER TABLE "pos_shifts" DROP COLUMN "cashIn"`);
    await queryRunner.query(
      `ALTER TABLE "pos_shifts" DROP COLUMN "creditTotal"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_cashiers" DROP COLUMN "maxDiscountPercent"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pos_cashiers" DROP COLUMN "isSupervisor"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customer_payments" DROP COLUMN "shiftId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "sales_settings" DROP COLUMN "posOptions"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_36d676710f35a03e03e125fc2f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e4ec567cfb7c008817efe2c976"`,
    );
    await queryRunner.query(`DROP TABLE "pos_promotions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a378ac6feeafbfb3eb1486f516"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c30c1263a24b651bf6d915b9d7"`,
    );
    await queryRunner.query(`DROP TABLE "pos_audit_logs"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3357e04d91063ac937868b6902"`,
    );
    await queryRunner.query(`DROP TABLE "pos_cash_movements"`);
    await queryRunner.query(`DROP TYPE "public"."pos_promotions_type_enum"`);
    await queryRunner.query(
      `DROP TYPE "public"."pos_cash_movements_type_enum"`,
    );
  }
}
