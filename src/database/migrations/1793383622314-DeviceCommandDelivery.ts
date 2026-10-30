// تسليم أوامر أجهزة ZKTeco: مرات الإرسال (أمر بلا رد يُعاد ثم يُترك فلا يسد
// الطابور)، وآخر تعريف للجهاز (بلا تعريف لا نعرف صيغة أوامره فنطلبه بـ CHECK).
// جهاز معروف الإصدار عرّف نفسه من قبل؛ غيره يُطلب تعريفه عند أول أمر.
import { MigrationInterface, QueryRunner } from "typeorm";

export class DeviceCommandDelivery1793383622314 implements MigrationInterface {
    name = 'DeviceCommandDelivery1793383622314'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "device_commands" ADD "attempts" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "device_commands" ADD "sentAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "biometric_devices" ADD "handshake_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`UPDATE "biometric_devices" SET "handshake_at" = COALESCE("last_seen_at", now()) WHERE "push_version" IS NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "biometric_devices" DROP COLUMN "handshake_at"`);
        await queryRunner.query(`ALTER TABLE "device_commands" DROP COLUMN "sentAt"`);
        await queryRunner.query(`ALTER TABLE "device_commands" DROP COLUMN "attempts"`);
    }

}
