// تطبيق الموظف على الجوال: موقع الفرع ونطاق بصمته، ربط الجوال بالموظف، موقع
// بصمة الجوال في سجل الحضور، وجلسة أطول لدخول التطبيق.
import { MigrationInterface, QueryRunner } from "typeorm";

export class MobileApp1793400000000 implements MigrationInterface {
    name = 'MobileApp1793400000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "branches" ADD "latitude" numeric(9,6)`);
        await queryRunner.query(`ALTER TABLE "branches" ADD "longitude" numeric(9,6)`);
        await queryRunner.query(`ALTER TABLE "branches" ADD "punchRadiusMeters" integer NOT NULL DEFAULT '150'`);

        await queryRunner.query(`ALTER TABLE "employees" ADD "mobile_punch_enabled" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "employees" ADD "mobile_device_id" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "employees" ADD "mobile_device_name" character varying(120)`);
        await queryRunner.query(`ALTER TABLE "employees" ADD "mobile_device_bound_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_employees_mobile_device" ON "employees" ("tenant_id", "mobile_device_id") WHERE "mobile_device_id" IS NOT NULL`);

        await queryRunner.query(`ALTER TYPE "public"."attendance_logs_verify_mode_enum" ADD VALUE IF NOT EXISTS 'mobile'`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" ADD "latitude" double precision`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" ADD "longitude" double precision`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" ADD "distance_meters" integer`);

        await queryRunner.query(`ALTER TABLE "auth_sessions" ADD "client" character varying(10) NOT NULL DEFAULT 'web'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "auth_sessions" DROP COLUMN "client"`);

        await queryRunner.query(`ALTER TABLE "attendance_logs" DROP COLUMN "distance_meters"`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" DROP COLUMN "longitude"`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" DROP COLUMN "latitude"`);
        // قيمة 'mobile' تبقى في نوع verify_mode: PostgreSQL لا يحذف قيمة من enum

        await queryRunner.query(`DROP INDEX "public"."UQ_employees_mobile_device"`);
        await queryRunner.query(`ALTER TABLE "employees" DROP COLUMN "mobile_device_bound_at"`);
        await queryRunner.query(`ALTER TABLE "employees" DROP COLUMN "mobile_device_name"`);
        await queryRunner.query(`ALTER TABLE "employees" DROP COLUMN "mobile_device_id"`);
        await queryRunner.query(`ALTER TABLE "employees" DROP COLUMN "mobile_punch_enabled"`);

        await queryRunner.query(`ALTER TABLE "branches" DROP COLUMN "punchRadiusMeters"`);
        await queryRunner.query(`ALTER TABLE "branches" DROP COLUMN "longitude"`);
        await queryRunner.query(`ALTER TABLE "branches" DROP COLUMN "latitude"`);
    }
}
