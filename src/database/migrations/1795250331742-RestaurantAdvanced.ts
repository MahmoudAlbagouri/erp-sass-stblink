import { MigrationInterface, QueryRunner } from "typeorm";

export class RestaurantAdvanced1795250331742 implements MigrationInterface {
    name = 'RestaurantAdvanced1795250331742'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "modifier_groups" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "name" character varying(100) NOT NULL, "minSelect" integer NOT NULL DEFAULT '0', "maxSelect" integer NOT NULL DEFAULT '1', "sortOrder" integer NOT NULL DEFAULT '0', "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_b3cea1c985339de5ea73d77101d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_a840d62058ef38497d121bf2cb" ON "modifier_groups" ("tenantId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c1fe4c028901036ec5cc28aea9" ON "modifier_groups" ("tenantId", "name") WHERE "deletedAt" IS NULL`);
        await queryRunner.query(`CREATE TABLE "modifier_options" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "groupId" uuid NOT NULL, "name" character varying(100) NOT NULL, "priceDelta" numeric(13,3) NOT NULL DEFAULT '0', "productId" uuid, "quantity" numeric(14,4) NOT NULL DEFAULT '1', "removesProductId" uuid, "isDefault" boolean NOT NULL DEFAULT false, "sortOrder" integer NOT NULL DEFAULT '0', "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_55e07bad7529e62c4d0f2b5fdc8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_78598c3b139d67ed077badb37f" ON "modifier_options" ("groupId") `);
        await queryRunner.query(`CREATE TABLE "product_modifier_groups" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "productId" uuid NOT NULL, "groupId" uuid NOT NULL, "sortOrder" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_d0756116a955991e3eaeddce51e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a357e103761a8d0bd4f2e71c3f" ON "product_modifier_groups" ("productId", "groupId") `);
        await queryRunner.query(`CREATE TABLE "kitchen_stations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "name" character varying(80) NOT NULL, "branchId" uuid, "categoryIds" jsonb NOT NULL DEFAULT '[]', "targetMinutes" integer, "sortOrder" integer NOT NULL DEFAULT '0', "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_8157ddec935aa73aef0b111c16c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_b7275757b950dc5d092bd75138" ON "kitchen_stations" ("tenantId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4ae95a0918643667e9dcab44aa" ON "kitchen_stations" ("tenantId", "name") WHERE "deletedAt" IS NULL`);
        await queryRunner.query(`CREATE TABLE "reservations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "number" character varying(20) NOT NULL, "branchId" uuid, "tableId" uuid, "customerId" uuid, "customerName" character varying(150) NOT NULL, "phone" character varying(30), "guestCount" integer NOT NULL DEFAULT '2', "reservedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "durationMinutes" integer NOT NULL DEFAULT '90', "status" character varying(20) NOT NULL DEFAULT 'booked', "source" character varying(20) NOT NULL DEFAULT 'phone', "note" character varying(500), "seatedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "createdById" uuid, CONSTRAINT "PK_da95cef71b617ac35dc5bcda243" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_555b226eb40a29e05177160120" ON "reservations" ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_99afcc1a2ab970f372878ff0b0" ON "reservations" ("tenantId", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_92f761518bdb41a3234a1f5fdd" ON "reservations" ("tenantId", "reservedAt") `);
        await queryRunner.query(`ALTER TABLE "sales_invoices" ADD "orderType" character varying(20)`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" ADD "tableId" uuid`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" ADD "tableName" character varying(60)`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" ADD "guestCount" integer`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" ADD "orderOpenedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" ADD "waiterName" character varying(150)`);
        await queryRunner.query(`ALTER TABLE "sales_invoice_lines" ADD "modifiers" jsonb`);
        await queryRunner.query(`ALTER TABLE "kitchen_orders" ADD "stations" jsonb NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "modifier_groups" ADD CONSTRAINT "FK_a840d62058ef38497d121bf2cba" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "modifier_options" ADD CONSTRAINT "FK_78598c3b139d67ed077badb37fc" FOREIGN KEY ("groupId") REFERENCES "modifier_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "modifier_options" ADD CONSTRAINT "FK_4bdcf7d26c5571cdccb563ad2f8" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "FK_7040749cab439084f923c4bae89" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "FK_20f16594ba4f324a32f7db6879e" FOREIGN KEY ("groupId") REFERENCES "modifier_groups"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "kitchen_stations" ADD CONSTRAINT "FK_b7275757b950dc5d092bd751387" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reservations" ADD CONSTRAINT "FK_555b226eb40a29e051771601202" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "reservations" ADD CONSTRAINT "FK_42ee40914a466cb26141c81e878" FOREIGN KEY ("tableId") REFERENCES "dining_tables"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "reservations" DROP CONSTRAINT "FK_42ee40914a466cb26141c81e878"`);
        await queryRunner.query(`ALTER TABLE "reservations" DROP CONSTRAINT "FK_555b226eb40a29e051771601202"`);
        await queryRunner.query(`ALTER TABLE "kitchen_stations" DROP CONSTRAINT "FK_b7275757b950dc5d092bd751387"`);
        await queryRunner.query(`ALTER TABLE "product_modifier_groups" DROP CONSTRAINT "FK_20f16594ba4f324a32f7db6879e"`);
        await queryRunner.query(`ALTER TABLE "product_modifier_groups" DROP CONSTRAINT "FK_7040749cab439084f923c4bae89"`);
        await queryRunner.query(`ALTER TABLE "modifier_options" DROP CONSTRAINT "FK_4bdcf7d26c5571cdccb563ad2f8"`);
        await queryRunner.query(`ALTER TABLE "modifier_options" DROP CONSTRAINT "FK_78598c3b139d67ed077badb37fc"`);
        await queryRunner.query(`ALTER TABLE "modifier_groups" DROP CONSTRAINT "FK_a840d62058ef38497d121bf2cba"`);
        await queryRunner.query(`ALTER TABLE "kitchen_orders" DROP COLUMN "stations"`);
        await queryRunner.query(`ALTER TABLE "sales_invoice_lines" DROP COLUMN "modifiers"`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" DROP COLUMN "waiterName"`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" DROP COLUMN "orderOpenedAt"`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" DROP COLUMN "guestCount"`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" DROP COLUMN "tableName"`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" DROP COLUMN "tableId"`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" DROP COLUMN "orderType"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_92f761518bdb41a3234a1f5fdd"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_99afcc1a2ab970f372878ff0b0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_555b226eb40a29e05177160120"`);
        await queryRunner.query(`DROP TABLE "reservations"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4ae95a0918643667e9dcab44aa"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b7275757b950dc5d092bd75138"`);
        await queryRunner.query(`DROP TABLE "kitchen_stations"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a357e103761a8d0bd4f2e71c3f"`);
        await queryRunner.query(`DROP TABLE "product_modifier_groups"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_78598c3b139d67ed077badb37f"`);
        await queryRunner.query(`DROP TABLE "modifier_options"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c1fe4c028901036ec5cc28aea9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a840d62058ef38497d121bf2cb"`);
        await queryRunner.query(`DROP TABLE "modifier_groups"`);
    }

}
