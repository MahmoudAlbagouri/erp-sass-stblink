import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePos1791796993296 implements MigrationInterface {
    name = 'CreatePos1791796993296'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "pos_devices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "name" character varying NOT NULL, "code" character varying(10) NOT NULL, "warehouseId" uuid NOT NULL, "lastCounter" integer NOT NULL DEFAULT '0', "lastSeenAt" TIMESTAMP WITH TIME ZONE, "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_c0ff7727c48303b51a158f8a202" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fbf0f3509ab78a4c0bc68fd64d" ON "pos_devices" ("tenantId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_becb3d0b12b7ac81f74f409357" ON "pos_devices" ("tenantId", "code") `);
        await queryRunner.query(`CREATE TYPE "public"."pos_shifts_status_enum" AS ENUM('open', 'closed')`);
        await queryRunner.query(`CREATE TABLE "pos_shifts" ("id" uuid NOT NULL, "tenantId" uuid NOT NULL, "deviceId" uuid NOT NULL, "userId" uuid, "cashierName" character varying(150), "status" "public"."pos_shifts_status_enum" NOT NULL DEFAULT 'open', "openedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "openingCash" numeric(14,2) NOT NULL DEFAULT '0', "closedAt" TIMESTAMP WITH TIME ZONE, "invoicesCount" integer NOT NULL DEFAULT '0', "salesTotal" numeric(14,2) NOT NULL DEFAULT '0', "cashTotal" numeric(14,2) NOT NULL DEFAULT '0', "cardTotal" numeric(14,2) NOT NULL DEFAULT '0', "expectedCash" numeric(14,2) NOT NULL DEFAULT '0', "closingCash" numeric(14,2), "cashDifference" numeric(14,2) NOT NULL DEFAULT '0', "note" character varying(500), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_48c3a5a8edb67abfa198992a0fa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_ec8223fca9ae0fe61d175eb35b" ON "pos_shifts" ("tenantId", "openedAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_d9fd53244d19f46380020a0ed3" ON "pos_shifts" ("tenantId", "deviceId", "status") `);
        await queryRunner.query(`ALTER TABLE "sales_invoices" ADD "shiftId" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_c72c5795c95f4dc61cd3219a9e" ON "sales_invoices" ("shiftId") `);
        await queryRunner.query(`ALTER TABLE "pos_devices" ADD CONSTRAINT "FK_fbf0f3509ab78a4c0bc68fd64de" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pos_devices" ADD CONSTRAINT "FK_46a07a52dd476d8590f2b16015a" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "pos_shifts" ADD CONSTRAINT "FK_bb41d7393dcb9aad657425b2d5b" FOREIGN KEY ("deviceId") REFERENCES "pos_devices"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "pos_shifts" DROP CONSTRAINT "FK_bb41d7393dcb9aad657425b2d5b"`);
        await queryRunner.query(`ALTER TABLE "pos_devices" DROP CONSTRAINT "FK_46a07a52dd476d8590f2b16015a"`);
        await queryRunner.query(`ALTER TABLE "pos_devices" DROP CONSTRAINT "FK_fbf0f3509ab78a4c0bc68fd64de"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c72c5795c95f4dc61cd3219a9e"`);
        await queryRunner.query(`ALTER TABLE "sales_invoices" DROP COLUMN "shiftId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d9fd53244d19f46380020a0ed3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ec8223fca9ae0fe61d175eb35b"`);
        await queryRunner.query(`DROP TABLE "pos_shifts"`);
        await queryRunner.query(`DROP TYPE "public"."pos_shifts_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_becb3d0b12b7ac81f74f409357"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fbf0f3509ab78a4c0bc68fd64d"`);
        await queryRunner.query(`DROP TABLE "pos_devices"`);
    }

}
