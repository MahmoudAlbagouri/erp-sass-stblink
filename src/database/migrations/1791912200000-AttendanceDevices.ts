import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * موديول البصمة: منطقة زمنية اختيارية لكل جهاز، نتيجة تنفيذ أوامر الأجهزة،
 * وفهرسان لمسارَي الاستقبال (منع تكرار البصمة، وأمر الجهاز التالي).
 *
 * لا يعدّل أي بصمة مسجّلة.
 */
export class AttendanceDevices1791912200000 implements MigrationInterface {
  name = 'AttendanceDevices1791912200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "biometric_devices" ADD "timezone" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "device_commands" ADD "executedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "device_commands" ADD "returnCode" integer`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_device_commands_device_pending" ON "device_commands" ("deviceId", "isExecuted")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_attendance_logs_device_raw" ON "attendance_logs" ("device_sn", "raw_log_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_attendance_logs_device_raw"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_device_commands_device_pending"`,
    );
    await queryRunner.query(
      `ALTER TABLE "device_commands" DROP COLUMN "returnCode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "device_commands" DROP COLUMN "executedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "biometric_devices" DROP COLUMN "timezone"`,
    );
  }
}
