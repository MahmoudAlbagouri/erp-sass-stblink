import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateInventory1791784099430 implements MigrationInterface {
    name = 'CreateInventory1791784099430'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."warehouses_type_enum" AS ENUM('main', 'branch')`);
        await queryRunner.query(`CREATE TABLE "warehouses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "name" character varying NOT NULL, "code" character varying(20), "type" "public"."warehouses_type_enum" NOT NULL DEFAULT 'branch', "address" character varying, "phone" character varying(30), "allowNegativeStock" boolean NOT NULL DEFAULT true, "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_56ae21ee2432b2270b48867e4be" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c747b0a69a22b026c99bac8b10" ON "warehouses" ("tenantId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_332eedef00aadaaa3d6ce1960b" ON "warehouses" ("tenantId") WHERE "type" = 'main' AND "deletedAt" IS NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_20600f1a8bdc9cd6b776fe3ff5" ON "warehouses" ("tenantId", "name") WHERE "deletedAt" IS NULL`);
        await queryRunner.query(`CREATE TYPE "public"."stocktakes_status_enum" AS ENUM('draft', 'posted', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "stocktakes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "number" character varying(20) NOT NULL, "warehouseId" uuid NOT NULL, "status" "public"."stocktakes_status_enum" NOT NULL DEFAULT 'draft', "note" character varying(500), "createdById" uuid, "postedAt" TIMESTAMP WITH TIME ZONE, "postedById" uuid, CONSTRAINT "PK_06743abbde0490196ad25408080" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_95511fc9cb7bd5aaa771a43ec5" ON "stocktakes" ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_e6be65e894fbed186df6871a91" ON "stocktakes" ("tenantId", "status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a233d70ba772f115d84aa0b44c" ON "stocktakes" ("tenantId", "number") `);
        await queryRunner.query(`CREATE TABLE "stocktake_lines" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "stocktakeId" uuid NOT NULL, "productId" uuid NOT NULL, "countedQuantity" numeric(14,4) NOT NULL, "expectedQuantity" numeric(14,4), "unitCost" numeric(14,4) NOT NULL DEFAULT '0', CONSTRAINT "PK_6c7688e8cc522bbf7987a062b8f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_55a442b86c25f8c247758e1c63" ON "stocktake_lines" ("stocktakeId", "productId") `);
        await queryRunner.query(`CREATE TYPE "public"."stock_transfers_status_enum" AS ENUM('draft', 'in_transit', 'received', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "stock_transfers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "number" character varying(20) NOT NULL, "fromWarehouseId" uuid NOT NULL, "toWarehouseId" uuid NOT NULL, "status" "public"."stock_transfers_status_enum" NOT NULL DEFAULT 'draft', "note" character varying(500), "createdById" uuid, "sentAt" TIMESTAMP WITH TIME ZONE, "sentById" uuid, "receivedAt" TIMESTAMP WITH TIME ZONE, "receivedById" uuid, CONSTRAINT "PK_ef738a3a4a578c7f1802c1bb50a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_35a3b1bdea06d49c59826fbddf" ON "stock_transfers" ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_3a27be310c51595dbad1d854c7" ON "stock_transfers" ("tenantId", "status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_447f7153c593ea2ecd3c68f460" ON "stock_transfers" ("tenantId", "number") `);
        await queryRunner.query(`CREATE TABLE "stock_transfer_lines" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "transferId" uuid NOT NULL, "productId" uuid NOT NULL, "quantity" numeric(14,4) NOT NULL, "receivedQuantity" numeric(14,4), "unitCost" numeric(14,4) NOT NULL DEFAULT '0', CONSTRAINT "PK_471b427d94a3f10ca3bcd9de9ef" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_bbe52156a6c848218a86a48eeb" ON "stock_transfer_lines" ("transferId", "productId") `);
        await queryRunner.query(`CREATE TYPE "public"."stock_movements_type_enum" AS ENUM('opening', 'purchase', 'purchase_return', 'sale', 'sale_return', 'transfer_out', 'transfer_in', 'adjustment', 'stocktake')`);
        await queryRunner.query(`CREATE TABLE "stock_movements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "warehouseId" uuid NOT NULL, "productId" uuid NOT NULL, "type" "public"."stock_movements_type_enum" NOT NULL, "quantity" numeric(14,4) NOT NULL, "unitCost" numeric(14,4) NOT NULL DEFAULT '0', "balanceAfter" numeric(14,4) NOT NULL, "referenceType" character varying(40), "referenceId" uuid, "note" character varying(500), "createdById" uuid, "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_57a26b190618550d8e65fb860e7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f19f44679b1d4ccfd207626ed8" ON "stock_movements" ("tenantId", "referenceType", "referenceId") `);
        await queryRunner.query(`CREATE INDEX "IDX_db52ace3e7afbc430aa52e4342" ON "stock_movements" ("tenantId", "warehouseId", "occurredAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_878f87e6b8ed848b3103dadbcd" ON "stock_movements" ("tenantId", "productId", "occurredAt") `);
        await queryRunner.query(`CREATE TABLE "stock_levels" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "warehouseId" uuid NOT NULL, "productId" uuid NOT NULL, "quantity" numeric(14,4) NOT NULL DEFAULT '0', "minQuantity" numeric(14,4), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ee416fdf2f5696dff16fd0c1c90" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_9fa65357fd02047e663edea593" ON "stock_levels" ("tenantId", "productId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_88f05dd92e16e9940c67a57917" ON "stock_levels" ("warehouseId", "productId") `);
        await queryRunner.query(`CREATE TABLE "inventory_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "productId" uuid NOT NULL, "avgCost" numeric(14,4) NOT NULL DEFAULT '0', "lastCost" numeric(14,4) NOT NULL DEFAULT '0', "inTransitQuantity" numeric(14,4) NOT NULL DEFAULT '0', "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cf2f451407242e132547ac19169" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0ff3ffd4bfa39e7ba9e4fbf527" ON "inventory_items" ("tenantId", "productId") `);
        await queryRunner.query(`ALTER TABLE "warehouses" ADD CONSTRAINT "FK_c747b0a69a22b026c99bac8b100" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stocktakes" ADD CONSTRAINT "FK_95511fc9cb7bd5aaa771a43ec5a" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stocktakes" ADD CONSTRAINT "FK_88b0d126b73ac8ca29b296073ce" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stocktake_lines" ADD CONSTRAINT "FK_1e0f44823d6514cdda12031efaf" FOREIGN KEY ("stocktakeId") REFERENCES "stocktakes"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stocktake_lines" ADD CONSTRAINT "FK_325f12ae8935477a3945b471e64" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" ADD CONSTRAINT "FK_35a3b1bdea06d49c59826fbddf0" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" ADD CONSTRAINT "FK_684badd3999923339489222a0b7" FOREIGN KEY ("fromWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" ADD CONSTRAINT "FK_22928dc6cdfdc43ef470de801f4" FOREIGN KEY ("toWarehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "FK_0af6e5292c91cc6db7daddbd0f8" FOREIGN KEY ("transferId") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "FK_7932e0afc6e2ca2d6aef67faed8" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_movements" ADD CONSTRAINT "FK_2d118fa925e343f74b7dfe822ec" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_movements" ADD CONSTRAINT "FK_a3acb59db67e977be45e382fc56" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_levels" ADD CONSTRAINT "FK_eaadbdcdebe3748847e8d212d9c" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_levels" ADD CONSTRAINT "FK_875faa3d8407d502b7f123e94f2" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "stock_levels" DROP CONSTRAINT "FK_875faa3d8407d502b7f123e94f2"`);
        await queryRunner.query(`ALTER TABLE "stock_levels" DROP CONSTRAINT "FK_eaadbdcdebe3748847e8d212d9c"`);
        await queryRunner.query(`ALTER TABLE "stock_movements" DROP CONSTRAINT "FK_a3acb59db67e977be45e382fc56"`);
        await queryRunner.query(`ALTER TABLE "stock_movements" DROP CONSTRAINT "FK_2d118fa925e343f74b7dfe822ec"`);
        await queryRunner.query(`ALTER TABLE "stock_transfer_lines" DROP CONSTRAINT "FK_7932e0afc6e2ca2d6aef67faed8"`);
        await queryRunner.query(`ALTER TABLE "stock_transfer_lines" DROP CONSTRAINT "FK_0af6e5292c91cc6db7daddbd0f8"`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" DROP CONSTRAINT "FK_22928dc6cdfdc43ef470de801f4"`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" DROP CONSTRAINT "FK_684badd3999923339489222a0b7"`);
        await queryRunner.query(`ALTER TABLE "stock_transfers" DROP CONSTRAINT "FK_35a3b1bdea06d49c59826fbddf0"`);
        await queryRunner.query(`ALTER TABLE "stocktake_lines" DROP CONSTRAINT "FK_325f12ae8935477a3945b471e64"`);
        await queryRunner.query(`ALTER TABLE "stocktake_lines" DROP CONSTRAINT "FK_1e0f44823d6514cdda12031efaf"`);
        await queryRunner.query(`ALTER TABLE "stocktakes" DROP CONSTRAINT "FK_88b0d126b73ac8ca29b296073ce"`);
        await queryRunner.query(`ALTER TABLE "stocktakes" DROP CONSTRAINT "FK_95511fc9cb7bd5aaa771a43ec5a"`);
        await queryRunner.query(`ALTER TABLE "warehouses" DROP CONSTRAINT "FK_c747b0a69a22b026c99bac8b100"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0ff3ffd4bfa39e7ba9e4fbf527"`);
        await queryRunner.query(`DROP TABLE "inventory_items"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_88f05dd92e16e9940c67a57917"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9fa65357fd02047e663edea593"`);
        await queryRunner.query(`DROP TABLE "stock_levels"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_878f87e6b8ed848b3103dadbcd"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_db52ace3e7afbc430aa52e4342"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f19f44679b1d4ccfd207626ed8"`);
        await queryRunner.query(`DROP TABLE "stock_movements"`);
        await queryRunner.query(`DROP TYPE "public"."stock_movements_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bbe52156a6c848218a86a48eeb"`);
        await queryRunner.query(`DROP TABLE "stock_transfer_lines"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_447f7153c593ea2ecd3c68f460"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3a27be310c51595dbad1d854c7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_35a3b1bdea06d49c59826fbddf"`);
        await queryRunner.query(`DROP TABLE "stock_transfers"`);
        await queryRunner.query(`DROP TYPE "public"."stock_transfers_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_55a442b86c25f8c247758e1c63"`);
        await queryRunner.query(`DROP TABLE "stocktake_lines"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a233d70ba772f115d84aa0b44c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e6be65e894fbed186df6871a91"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_95511fc9cb7bd5aaa771a43ec5"`);
        await queryRunner.query(`DROP TABLE "stocktakes"`);
        await queryRunner.query(`DROP TYPE "public"."stocktakes_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_20600f1a8bdc9cd6b776fe3ff5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_332eedef00aadaaa3d6ce1960b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c747b0a69a22b026c99bac8b10"`);
        await queryRunner.query(`DROP TABLE "warehouses"`);
        await queryRunner.query(`DROP TYPE "public"."warehouses_type_enum"`);
    }

}
