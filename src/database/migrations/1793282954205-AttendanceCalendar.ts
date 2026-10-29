// الحضور: أيام الراحة (للشركة والوردية)، العطلات الرسمية، رقم الموظف على جهاز
// البصمة، أمان الأجهزة وأنواعها (ZKTeco / Hikvision / API)، قوالب البصمات
// المنسوخة بين الأجهزة، وأثر الحضور في المسير. ساعات العمل لم تعد تُخزَّن على
// البصمات (تُحسب من أول بصمة وآخرها في اليوم).
import { MigrationInterface, QueryRunner } from "typeorm";

export class AttendanceCalendar1793282954205 implements MigrationInterface {
    name = 'AttendanceCalendar1793282954205'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "public_holidays" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "name" character varying(100) NOT NULL, "start_date" date NOT NULL, "end_date" date NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e959831bb7c79c39cc58207c122" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_96e27accec7b64975628044af9" ON "public_holidays" ("tenant_id", "start_date") `);
        await queryRunner.query(`CREATE TABLE "biometric_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "pin_key" character varying(30) NOT NULL, "employee_id" uuid, "kind" character varying(10) NOT NULL, "slot" character varying(20) NOT NULL, "data" text NOT NULL, "source_device_id" uuid, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_79d26cec11f276889d94a8d0909" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_0984501696ca9bcdc927af0fec" ON "biometric_templates" ("employee_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_biometric_templates_slot" ON "biometric_templates" ("tenant_id", "pin_key", "kind", "slot") `);
        await queryRunner.query(`CREATE TABLE "attendance_settings" ("tenant_id" uuid NOT NULL, "weekly_off_days" smallint array NOT NULL, "deduct_absence" boolean NOT NULL DEFAULT false, "deduct_lateness" boolean NOT NULL DEFAULT false, "pay_overtime" boolean NOT NULL DEFAULT false, "overtime_rate_percent" smallint NOT NULL DEFAULT '150', "overtime_min_minutes" smallint NOT NULL DEFAULT '30', "sync_biometrics" boolean NOT NULL DEFAULT false, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ade32d37e8f5d7af733c965201f" PRIMARY KEY ("tenant_id"))`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" DROP COLUMN "work_hours"`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" DROP COLUMN "overtime_hours"`);
        await queryRunner.query(`ALTER TABLE "shifts" ADD "offDays" smallint array`);
        await queryRunner.query(`ALTER TABLE "employees" ADD "attendance_pin" character varying(20)`);
        await queryRunner.query(`ALTER TABLE "payroll_items" ADD "absence_days" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "payroll_items" ADD "absence_deduction" numeric(13,3) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "payroll_items" ADD "late_minutes" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "payroll_items" ADD "late_deduction" numeric(13,3) NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "payroll_items" ADD "overtime_minutes" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "biometric_devices" ADD "protocol" character varying(20) NOT NULL DEFAULT 'zk_adms'`);
        await queryRunner.query(`ALTER TABLE "biometric_devices" ADD "allowed_ips" character varying(500)`);
        await queryRunner.query(`ALTER TABLE "biometric_devices" ADD "push_version" character varying(20)`);
        await queryRunner.query(`ALTER TABLE "biometric_devices" ADD "push_key_hash" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "biometric_devices" ADD "oper_log_stamp" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TYPE "public"."attendance_logs_verify_mode_enum" RENAME TO "attendance_logs_verify_mode_enum_old"`);
        await queryRunner.query(`CREATE TYPE "public"."attendance_logs_verify_mode_enum" AS ENUM('fingerprint', 'card', 'password', 'face', 'fingerprint_card', 'manual', 'palm', 'other')`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" ALTER COLUMN "verify_mode" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" ALTER COLUMN "verify_mode" TYPE "public"."attendance_logs_verify_mode_enum" USING "verify_mode"::"text"::"public"."attendance_logs_verify_mode_enum"`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" ALTER COLUMN "verify_mode" SET DEFAULT 'fingerprint'`);
        await queryRunner.query(`DROP TYPE "public"."attendance_logs_verify_mode_enum_old"`);
        await queryRunner.query(`ALTER TABLE "public_holidays" ADD CONSTRAINT "FK_770eaf132428a258d2c444e0054" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "biometric_templates" ADD CONSTRAINT "FK_73beea006223bdead8ed2f6c9b8" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "biometric_templates" ADD CONSTRAINT "FK_0984501696ca9bcdc927af0fec1" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "attendance_settings" ADD CONSTRAINT "FK_ade32d37e8f5d7af733c965201f" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        // أوامر تنتظر أجهزتها: إلى الصيغة المعتمدة (تُترجم للأجهزة القديمة عند الإرسال)
        await queryRunner.query(`
            UPDATE "device_commands"
               SET "command" = regexp_replace(
                     replace("command", 'DATA USER ', 'DATA UPDATE USERINFO '),
                     E'\tPass=0$', '')
             WHERE NOT "isExecuted" AND "command" LIKE 'DATA USER %'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // طرق التحقق الجديدة لا مقابل لها في النوع القديم
        await queryRunner.query(`UPDATE "attendance_logs" SET "verify_mode" = 'fingerprint' WHERE "verify_mode" IN ('palm', 'other')`);
        await queryRunner.query(`ALTER TABLE "attendance_settings" DROP CONSTRAINT "FK_ade32d37e8f5d7af733c965201f"`);
        await queryRunner.query(`ALTER TABLE "biometric_templates" DROP CONSTRAINT "FK_0984501696ca9bcdc927af0fec1"`);
        await queryRunner.query(`ALTER TABLE "biometric_templates" DROP CONSTRAINT "FK_73beea006223bdead8ed2f6c9b8"`);
        await queryRunner.query(`ALTER TABLE "public_holidays" DROP CONSTRAINT "FK_770eaf132428a258d2c444e0054"`);
        await queryRunner.query(`CREATE TYPE "public"."attendance_logs_verify_mode_enum_old" AS ENUM('fingerprint', 'card', 'password', 'face', 'fingerprint_card', 'manual')`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" ALTER COLUMN "verify_mode" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" ALTER COLUMN "verify_mode" TYPE "public"."attendance_logs_verify_mode_enum_old" USING "verify_mode"::"text"::"public"."attendance_logs_verify_mode_enum_old"`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" ALTER COLUMN "verify_mode" SET DEFAULT 'fingerprint'`);
        await queryRunner.query(`DROP TYPE "public"."attendance_logs_verify_mode_enum"`);
        await queryRunner.query(`ALTER TYPE "public"."attendance_logs_verify_mode_enum_old" RENAME TO "attendance_logs_verify_mode_enum"`);
        await queryRunner.query(`ALTER TABLE "biometric_devices" DROP COLUMN "oper_log_stamp"`);
        await queryRunner.query(`ALTER TABLE "biometric_devices" DROP COLUMN "push_key_hash"`);
        await queryRunner.query(`ALTER TABLE "biometric_devices" DROP COLUMN "push_version"`);
        await queryRunner.query(`ALTER TABLE "biometric_devices" DROP COLUMN "allowed_ips"`);
        await queryRunner.query(`ALTER TABLE "biometric_devices" DROP COLUMN "protocol"`);
        await queryRunner.query(`ALTER TABLE "payroll_items" DROP COLUMN "overtime_minutes"`);
        await queryRunner.query(`ALTER TABLE "payroll_items" DROP COLUMN "late_deduction"`);
        await queryRunner.query(`ALTER TABLE "payroll_items" DROP COLUMN "late_minutes"`);
        await queryRunner.query(`ALTER TABLE "payroll_items" DROP COLUMN "absence_deduction"`);
        await queryRunner.query(`ALTER TABLE "payroll_items" DROP COLUMN "absence_days"`);
        await queryRunner.query(`ALTER TABLE "employees" DROP COLUMN "attendance_pin"`);
        await queryRunner.query(`ALTER TABLE "shifts" DROP COLUMN "offDays"`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" ADD "overtime_hours" numeric(6,2)`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" ADD "work_hours" numeric(6,2)`);
        await queryRunner.query(`DROP TABLE "attendance_settings"`);
        await queryRunner.query(`DROP INDEX "public"."UQ_biometric_templates_slot"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0984501696ca9bcdc927af0fec"`);
        await queryRunner.query(`DROP TABLE "biometric_templates"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_96e27accec7b64975628044af9"`);
        await queryRunner.query(`DROP TABLE "public_holidays"`);
    }

}
