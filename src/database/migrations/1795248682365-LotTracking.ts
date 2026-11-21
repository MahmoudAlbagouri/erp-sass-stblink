import { MigrationInterface, QueryRunner } from "typeorm";

export class LotTracking1795248682365 implements MigrationInterface {
    name = 'LotTracking1795248682365'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "stock_lots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "productId" uuid NOT NULL, "lotNumber" character varying(60) NOT NULL, "expiryDate" date, "manufactureDate" date, "source" character varying(20) NOT NULL DEFAULT 'other', "sourceType" character varying(40), "sourceId" uuid, "supplierId" uuid, "note" character varying(500), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_578c4d59145e7d590780f29347b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0881bab014c368e4204756d157" ON "stock_lots" ("tenantId", "expiryDate") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ecf8b2af2a668927bb0fad4c34" ON "stock_lots" ("tenantId", "productId", "lotNumber") `);
        await queryRunner.query(`CREATE TABLE "stock_lot_levels" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "warehouseId" uuid NOT NULL, "productId" uuid NOT NULL, "lotId" uuid NOT NULL, "quantity" numeric(14,4) NOT NULL DEFAULT '0', "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_803d56c44c585a635e29a1cee00" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4fb7eefe5592f1a9e6a7964116" ON "stock_lot_levels" ("tenantId", "productId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a4c3dab7c9d742fc4165335cdf" ON "stock_lot_levels" ("warehouseId", "lotId") `);
        await queryRunner.query(`CREATE TABLE "stock_movement_lots" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "movementId" uuid NOT NULL, "lotId" uuid, "quantity" numeric(14,4) NOT NULL, CONSTRAINT "PK_f280668a63ce32696c3b36e1996" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5980d0c126dae73906b2130797" ON "stock_movement_lots" ("tenantId", "lotId") `);
        await queryRunner.query(`CREATE INDEX "IDX_84c3630c3c0818ff895d4148ff" ON "stock_movement_lots" ("movementId") `);
        await queryRunner.query(`ALTER TABLE "products" ADD "trackLots" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "products" ADD "shelfLifeDays" integer`);
        await queryRunner.query(`ALTER TABLE "products" ADD "procurement" character varying(10) NOT NULL DEFAULT 'buy'`);
        await queryRunner.query(`ALTER TABLE "purchase_invoice_lines" ADD "lotNumber" character varying(60)`);
        await queryRunner.query(`ALTER TABLE "purchase_invoice_lines" ADD "expiryDate" date`);
        await queryRunner.query(`ALTER TABLE "purchase_invoice_lines" ADD "manufactureDate" date`);
        await queryRunner.query(`ALTER TYPE "public"."products_type_enum" RENAME TO "products_type_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."products_type_enum" AS ENUM('stocked', 'service', 'composite')`);
        await queryRunner.query(`ALTER TABLE "products" ALTER COLUMN "type" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "products" ALTER COLUMN "type" TYPE "public"."products_type_enum" USING "type"::"text"::"public"."products_type_enum"`);
        await queryRunner.query(`ALTER TABLE "products" ALTER COLUMN "type" SET DEFAULT 'stocked'`);
        await queryRunner.query(`DROP TYPE "public"."products_type_enum_old"`);
        await queryRunner.query(`ALTER TYPE "public"."stock_movements_type_enum" RENAME TO "stock_movements_type_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."stock_movements_type_enum" AS ENUM('opening', 'purchase', 'purchase_return', 'sale', 'sale_return', 'transfer_out', 'transfer_in', 'adjustment', 'stocktake', 'production_issue', 'production_return', 'production_output', 'consumption', 'lot_assignment')`);
        await queryRunner.query(`ALTER TABLE "stock_movements" ALTER COLUMN "type" TYPE "public"."stock_movements_type_enum" USING "type"::"text"::"public"."stock_movements_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."stock_movements_type_enum_old"`);
        await queryRunner.query(`ALTER TABLE "stock_lots" ADD CONSTRAINT "FK_10283ab43e20af849410647fa91" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_lot_levels" ADD CONSTRAINT "FK_c520fc335080a706b3b58816bc2" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_lot_levels" ADD CONSTRAINT "FK_88fce18879aace0a8b378599b72" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_movement_lots" ADD CONSTRAINT "FK_84c3630c3c0818ff895d4148ff6" FOREIGN KEY ("movementId") REFERENCES "stock_movements"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "stock_movement_lots" ADD CONSTRAINT "FK_7811990d573b045724f0ac929f9" FOREIGN KEY ("lotId") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "stock_movement_lots" DROP CONSTRAINT "FK_7811990d573b045724f0ac929f9"`);
        await queryRunner.query(`ALTER TABLE "stock_movement_lots" DROP CONSTRAINT "FK_84c3630c3c0818ff895d4148ff6"`);
        await queryRunner.query(`ALTER TABLE "stock_lot_levels" DROP CONSTRAINT "FK_88fce18879aace0a8b378599b72"`);
        await queryRunner.query(`ALTER TABLE "stock_lot_levels" DROP CONSTRAINT "FK_c520fc335080a706b3b58816bc2"`);
        await queryRunner.query(`ALTER TABLE "stock_lots" DROP CONSTRAINT "FK_10283ab43e20af849410647fa91"`);
        await queryRunner.query(`CREATE TYPE "public"."stock_movements_type_enum_old" AS ENUM('opening', 'purchase', 'purchase_return', 'sale', 'sale_return', 'transfer_out', 'transfer_in', 'adjustment', 'stocktake')`);
        await queryRunner.query(`ALTER TABLE "stock_movements" ALTER COLUMN "type" TYPE "public"."stock_movements_type_enum_old" USING "type"::"text"::"public"."stock_movements_type_enum_old"`);
        await queryRunner.query(`DROP TYPE "public"."stock_movements_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."stock_movements_type_enum_old" RENAME TO "stock_movements_type_enum"`);
        await queryRunner.query(`CREATE TYPE "public"."products_type_enum_old" AS ENUM('stocked', 'service')`);
        await queryRunner.query(`ALTER TABLE "products" ALTER COLUMN "type" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "products" ALTER COLUMN "type" TYPE "public"."products_type_enum_old" USING "type"::"text"::"public"."products_type_enum_old"`);
        await queryRunner.query(`ALTER TABLE "products" ALTER COLUMN "type" SET DEFAULT 'stocked'`);
        await queryRunner.query(`DROP TYPE "public"."products_type_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."products_type_enum_old" RENAME TO "products_type_enum"`);
        await queryRunner.query(`ALTER TABLE "purchase_invoice_lines" DROP COLUMN "manufactureDate"`);
        await queryRunner.query(`ALTER TABLE "purchase_invoice_lines" DROP COLUMN "expiryDate"`);
        await queryRunner.query(`ALTER TABLE "purchase_invoice_lines" DROP COLUMN "lotNumber"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "procurement"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "shelfLifeDays"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "trackLots"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_84c3630c3c0818ff895d4148ff"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5980d0c126dae73906b2130797"`);
        await queryRunner.query(`DROP TABLE "stock_movement_lots"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a4c3dab7c9d742fc4165335cdf"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4fb7eefe5592f1a9e6a7964116"`);
        await queryRunner.query(`DROP TABLE "stock_lot_levels"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ecf8b2af2a668927bb0fad4c34"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0881bab014c368e4204756d157"`);
        await queryRunner.query(`DROP TABLE "stock_lots"`);
    }

}
