import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * المطاعم (docs/modules/pos.md):
 *
 * - dining_tables: طاولات الصالة (تنزل لشاشات الكاشير؛ الطلب المفتوح على
 *   الجهاز نفسه).
 * - kitchen_orders: بونات المطبخ — ترفعها شاشات الكاشير وتعرضها شاشة المطبخ
 *   بحالتها (جديد، قيد التحضير، جاهز، سُلّم).
 * - restaurant_settings: تصنيفات المطبخ، طباعة البون، والإرسال عند الدفع.
 */

export class RestaurantKitchen1792239700664 implements MigrationInterface {
    name = 'RestaurantKitchen1792239700664'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "dining_tables" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "name" character varying(60) NOT NULL, "area" character varying(60), "seats" integer NOT NULL DEFAULT '4', "branchId" uuid, "sortOrder" integer NOT NULL DEFAULT '0', "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_30bc22c71f39a9d32b7f7617757" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b97a10cdee9a8ea1f4c68911a9" ON "dining_tables" ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_66f894b04c8eb281f1bd7e61e1" ON "dining_tables" ("tenantId", "branchId") `);
        await queryRunner.query(`CREATE TYPE "public"."kitchen_orders_status_enum" AS ENUM('new', 'preparing', 'ready', 'served', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "kitchen_orders" ("id" uuid NOT NULL, "tenantId" uuid NOT NULL, "deviceId" uuid NOT NULL, "branchId" uuid, "shiftId" uuid, "ticketNo" integer NOT NULL, "orderType" character varying(20) NOT NULL, "tableId" uuid, "tableName" character varying(60), "label" character varying(100), "orderRef" uuid NOT NULL, "round" integer NOT NULL DEFAULT '1', "cashierName" character varying(150), "note" character varying(300), "lines" jsonb NOT NULL, "status" "public"."kitchen_orders_status_enum" NOT NULL DEFAULT 'new', "sentAt" TIMESTAMP WITH TIME ZONE NOT NULL, "startedAt" TIMESTAMP WITH TIME ZONE, "readyAt" TIMESTAMP WITH TIME ZONE, "servedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0f2d28a9bc01ec39f13f7b6cae4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_dfa16be2a198c5876653c144af" ON "kitchen_orders" ("tenantId", "orderRef") `);
        await queryRunner.query(`CREATE INDEX "IDX_95b9a22a00bc689c16d941eaa6" ON "kitchen_orders" ("tenantId", "deviceId", "sentAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_848ba738c8fe2b404b00f8fe4c" ON "kitchen_orders" ("tenantId", "branchId", "status") `);
        await queryRunner.query(`CREATE TABLE "restaurant_settings" ("tenantId" uuid NOT NULL, "kitchenCategoryIds" jsonb NOT NULL DEFAULT '[]', "printKitchenTicket" boolean NOT NULL DEFAULT true, "sendOnPayment" boolean NOT NULL DEFAULT true, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_d02a95124dc972d93af108c8d93" PRIMARY KEY ("tenantId"))`);
        await queryRunner.query(`ALTER TABLE "dining_tables" ADD CONSTRAINT "FK_b97a10cdee9a8ea1f4c68911a98" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "dining_tables" DROP CONSTRAINT "FK_b97a10cdee9a8ea1f4c68911a98"`);
        await queryRunner.query(`DROP TABLE "restaurant_settings"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_848ba738c8fe2b404b00f8fe4c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_95b9a22a00bc689c16d941eaa6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dfa16be2a198c5876653c144af"`);
        await queryRunner.query(`DROP TABLE "kitchen_orders"`);
        await queryRunner.query(`DROP TYPE "public"."kitchen_orders_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_66f894b04c8eb281f1bd7e61e1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b97a10cdee9a8ea1f4c68911a9"`);
        await queryRunner.query(`DROP TABLE "dining_tables"`);
    }

}
