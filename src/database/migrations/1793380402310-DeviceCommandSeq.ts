// رقم صحيح لكل أمر جهاز بصمة: أجهزة ZKTeco تتجاهل أمراً رقمه UUID. الأوامر
// المنتظرة تأخذ أرقامها هنا فتُرسل من جديد بالصيغة الصحيحة بعد النشر.
import { MigrationInterface, QueryRunner } from "typeorm";

export class DeviceCommandSeq1793380402310 implements MigrationInterface {
    name = 'DeviceCommandSeq1793380402310'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "device_commands" ADD "seq" SERIAL NOT NULL`);
        await queryRunner.query(`ALTER TABLE "device_commands" ADD CONSTRAINT "UQ_4f5e00fd3d2219e577d9fe4f494" UNIQUE ("seq")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "device_commands" DROP CONSTRAINT "UQ_4f5e00fd3d2219e577d9fe4f494"`);
        await queryRunner.query(`ALTER TABLE "device_commands" DROP COLUMN "seq"`);
    }

}
