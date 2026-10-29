// جلسات الدخول على السيرفر: الخروج يلغي الجلسة فعلاً (لا يكفي حذف التوكن من
// المتصفح). توكنات التجديد الصادرة قبلها بلا جلسة: تُرفض، فيدخل كل مستخدم
// مرة واحدة بعد النشر.
import { MigrationInterface, QueryRunner } from "typeorm";

export class AuthSessions1793296766116 implements MigrationInterface {
    name = 'AuthSessions1793296766116'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "auth_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_used_at" TIMESTAMP WITH TIME ZONE NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_641507381f32580e8479efc36cd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_50ccaa6440288a06f0ba693ccc" ON "auth_sessions" ("user_id") `);
        await queryRunner.query(`ALTER TABLE "auth_sessions" ADD CONSTRAINT "FK_50ccaa6440288a06f0ba693ccc6" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "auth_sessions" DROP CONSTRAINT "FK_50ccaa6440288a06f0ba693ccc6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_50ccaa6440288a06f0ba693ccc"`);
        await queryRunner.query(`DROP TABLE "auth_sessions"`);
    }

}
