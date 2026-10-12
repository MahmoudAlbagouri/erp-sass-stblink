import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateCatalog1791781759848 implements MigrationInterface {
    name = 'CreateCatalog1791781759848'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "units" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "name" character varying NOT NULL, "symbol" character varying, "allowsFractions" boolean NOT NULL DEFAULT false, "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_5a8f2f064919b587d93936cb223" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cb4d16ad5d8d72b4af76338ae7" ON "units" ("tenantId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_d3d5c2b144d30f6cdb33f8949d" ON "units" ("tenantId", "name") WHERE "deletedAt" IS NULL`);
        await queryRunner.query(`CREATE TYPE "public"."tax_rates_category_enum" AS ENUM('S', 'Z', 'E', 'O')`);
        await queryRunner.query(`CREATE TABLE "tax_rates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "name" character varying NOT NULL, "rate" numeric(5,2) NOT NULL, "category" "public"."tax_rates_category_enum" NOT NULL DEFAULT 'S', "isDefault" boolean NOT NULL DEFAULT false, "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_41164a748f3dafa373c7e508ca2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f3b8fedd11b19143dd32287b6a" ON "tax_rates" ("tenantId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_72b93122e32bdaf510e024c4e3" ON "tax_rates" ("tenantId", "name") WHERE "deletedAt" IS NULL`);
        await queryRunner.query(`CREATE TABLE "product_barcodes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "productId" uuid NOT NULL, "barcode" character varying NOT NULL, "unitId" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_459d7d53aebb732e6c8460247d6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_258b80cebb40fb6ac0f5412695" ON "product_barcodes" ("productId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9ea55c8ac9dab9e48ea5c0b206" ON "product_barcodes" ("tenantId", "barcode") `);
        await queryRunner.query(`CREATE TABLE "product_categories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "name" character varying NOT NULL, "nameEn" character varying, "parentId" uuid, "color" character varying(9), "sortOrder" integer NOT NULL DEFAULT '0', "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_7069dac60d88408eca56fdc9e0c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_511a82b0123c941ba3f49ab025" ON "product_categories" ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_05e5fb5feedb3c6ea2372ce7cf" ON "product_categories" ("tenantId", "parentId") `);
        await queryRunner.query(`CREATE TABLE "product_units" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "productId" uuid NOT NULL, "unitId" uuid NOT NULL, "factor" numeric(12,4) NOT NULL, "salePrice" numeric(12,2), CONSTRAINT "PK_d26a9abe8b38cdd765716265977" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_03b04048def76bf1f81cb0e01d" ON "product_units" ("productId", "unitId") `);
        await queryRunner.query(`CREATE TYPE "public"."products_type_enum" AS ENUM('stocked', 'service')`);
        await queryRunner.query(`CREATE TABLE "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "name" character varying NOT NULL, "nameEn" character varying, "sku" character varying NOT NULL, "type" "public"."products_type_enum" NOT NULL DEFAULT 'stocked', "categoryId" uuid, "baseUnitId" uuid NOT NULL, "taxRateId" uuid NOT NULL, "salePrice" numeric(12,2) NOT NULL DEFAULT '0', "priceIncludesTax" boolean NOT NULL DEFAULT true, "minSalePrice" numeric(12,2), "allowDiscount" boolean NOT NULL DEFAULT true, "isWeighted" boolean NOT NULL DEFAULT false, "description" text, "imagePath" character varying, "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_6804855ba1a19523ea57e0769b" ON "products" ("tenantId") `);
        await queryRunner.query(`CREATE INDEX "IDX_f5d0c01ced89a7765b690c582b" ON "products" ("tenantId", "updatedAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_60641843a69bd415aa8840e30f" ON "products" ("tenantId", "categoryId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_5ad331b5886e301e44a6109cf1" ON "products" ("tenantId", "sku") WHERE "deletedAt" IS NULL`);
        await queryRunner.query(`ALTER TABLE "units" ADD CONSTRAINT "FK_cb4d16ad5d8d72b4af76338ae79" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "tax_rates" ADD CONSTRAINT "FK_f3b8fedd11b19143dd32287b6aa" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_barcodes" ADD CONSTRAINT "FK_258b80cebb40fb6ac0f54126959" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_barcodes" ADD CONSTRAINT "FK_da52a84dd9cc431862c0db63962" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_categories" ADD CONSTRAINT "FK_511a82b0123c941ba3f49ab025e" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_categories" ADD CONSTRAINT "FK_cbf04073e03d8873ae0662053a3" FOREIGN KEY ("parentId") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_units" ADD CONSTRAINT "FK_3c56b41ac865c101a8022b59fe0" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "product_units" ADD CONSTRAINT "FK_d373a20e06122cc1016d803104c" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_6804855ba1a19523ea57e0769b4" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_ff56834e735fa78a15d0cf21926" FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_8f02492cd2cba26de537ffd6b98" FOREIGN KEY ("baseUnitId") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "FK_e7065a225757caffb52a0c8781a" FOREIGN KEY ("taxRateId") REFERENCES "tax_rates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_e7065a225757caffb52a0c8781a"`);
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_8f02492cd2cba26de537ffd6b98"`);
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_ff56834e735fa78a15d0cf21926"`);
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_6804855ba1a19523ea57e0769b4"`);
        await queryRunner.query(`ALTER TABLE "product_units" DROP CONSTRAINT "FK_d373a20e06122cc1016d803104c"`);
        await queryRunner.query(`ALTER TABLE "product_units" DROP CONSTRAINT "FK_3c56b41ac865c101a8022b59fe0"`);
        await queryRunner.query(`ALTER TABLE "product_categories" DROP CONSTRAINT "FK_cbf04073e03d8873ae0662053a3"`);
        await queryRunner.query(`ALTER TABLE "product_categories" DROP CONSTRAINT "FK_511a82b0123c941ba3f49ab025e"`);
        await queryRunner.query(`ALTER TABLE "product_barcodes" DROP CONSTRAINT "FK_da52a84dd9cc431862c0db63962"`);
        await queryRunner.query(`ALTER TABLE "product_barcodes" DROP CONSTRAINT "FK_258b80cebb40fb6ac0f54126959"`);
        await queryRunner.query(`ALTER TABLE "tax_rates" DROP CONSTRAINT "FK_f3b8fedd11b19143dd32287b6aa"`);
        await queryRunner.query(`ALTER TABLE "units" DROP CONSTRAINT "FK_cb4d16ad5d8d72b4af76338ae79"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5ad331b5886e301e44a6109cf1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_60641843a69bd415aa8840e30f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f5d0c01ced89a7765b690c582b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6804855ba1a19523ea57e0769b"`);
        await queryRunner.query(`DROP TABLE "products"`);
        await queryRunner.query(`DROP TYPE "public"."products_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_03b04048def76bf1f81cb0e01d"`);
        await queryRunner.query(`DROP TABLE "product_units"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_05e5fb5feedb3c6ea2372ce7cf"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_511a82b0123c941ba3f49ab025"`);
        await queryRunner.query(`DROP TABLE "product_categories"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9ea55c8ac9dab9e48ea5c0b206"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_258b80cebb40fb6ac0f5412695"`);
        await queryRunner.query(`DROP TABLE "product_barcodes"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_72b93122e32bdaf510e024c4e3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f3b8fedd11b19143dd32287b6a"`);
        await queryRunner.query(`DROP TABLE "tax_rates"`);
        await queryRunner.query(`DROP TYPE "public"."tax_rates_category_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d3d5c2b144d30f6cdb33f8949d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cb4d16ad5d8d72b4af76338ae7"`);
        await queryRunner.query(`DROP TABLE "units"`);
    }

}
