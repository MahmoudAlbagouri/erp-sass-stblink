import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSupportSessions1791800307625 implements MigrationInterface {
    name = 'CreateSupportSessions1791800307625'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "support_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ownerId" uuid NOT NULL, "tenantId" uuid NOT NULL, "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "lastSeenAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3f42d6581b7be63ce898b1d0f65" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4d2e31168a59c7f54213785564" ON "support_sessions" ("ownerId", "tenantId", "lastSeenAt") `);
        await queryRunner.query(`CREATE INDEX "IDX_760d4966b3d7505075e11d0136" ON "support_sessions" ("tenantId", "startedAt") `);
        await queryRunner.query(`ALTER TABLE "support_sessions" ADD CONSTRAINT "FK_875c5eb61c2c6bebe85f50c6d3a" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "support_sessions" DROP CONSTRAINT "FK_875c5eb61c2c6bebe85f50c6d3a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_760d4966b3d7505075e11d0136"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4d2e31168a59c7f54213785564"`);
        await queryRunner.query(`DROP TABLE "support_sessions"`);
    }

}
