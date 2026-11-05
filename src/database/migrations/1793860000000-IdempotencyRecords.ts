// مفاتيح عمليات الحفظ الآمنة الإعادة (Idempotency-Key): طوابير العمل بلا إنترنت
// في التطبيق ولوحة التحكم ترفع عملياتها مرة ثانية دون أن تتكرر.
import { MigrationInterface, QueryRunner } from 'typeorm';

export class IdempotencyRecords1793860000000 implements MigrationInterface {
  name = 'IdempotencyRecords1793860000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "idempotency_records" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "tenantId" uuid, "key" character varying(100) NOT NULL, "method" character varying(10) NOT NULL, "path" character varying(300) NOT NULL, "completed" boolean NOT NULL DEFAULT false, "response" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_idempotency_records" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_idempotency_user_key" ON "idempotency_records" ("userId", "key") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_idempotency_created" ON "idempotency_records" ("createdAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_idempotency_created"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_idempotency_user_key"`);
    await queryRunner.query(`DROP TABLE "idempotency_records"`);
  }
}
