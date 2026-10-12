import { MigrationInterface, QueryRunner } from "typeorm";

export class Baseline1791780653022 implements MigrationInterface {
    name = 'Baseline1791780653022'

    /**
     * نقطة البداية: الـ schema كما كان وقت الانتقال من `synchronize: true`
     * إلى الـ migrations.
     *
     * - قاعدة جديدة فارغة  → تُنشأ كل الجداول من هنا.
     * - قاعدة قائمة (أنشأها synchronize سابقاً) → الجداول موجودة بالفعل،
     *   فنتجاوز الإنشاء ويُسجَّل الـ migration كمنفَّذ فقط.
     */
    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('users')) {
            return;
        }

        await queryRunner.query(`CREATE TYPE "public"."plans_billingcycle_enum" AS ENUM('monthly', 'yearly', 'lifetime')`);
        await queryRunner.query(`CREATE TABLE "plans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "nameAr" character varying NOT NULL, "description" text, "price" numeric(10,2) NOT NULL DEFAULT '0', "billingCycle" "public"."plans_billingcycle_enum" NOT NULL DEFAULT 'monthly', "features" jsonb NOT NULL DEFAULT '[]', "quotas" jsonb NOT NULL DEFAULT '{}', "isActive" boolean NOT NULL DEFAULT true, "isCustom" boolean NOT NULL DEFAULT false, "sortOrder" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_253d25dae4c94ee913bc5ec4850" UNIQUE ("name"), CONSTRAINT "PK_3720521a81c7c24fe9b7202ba61" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_status_enum" AS ENUM('trial', 'active', 'expired', 'cancelled', 'suspended', 'pending')`);
        await queryRunner.query(`CREATE TABLE "subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "planId" uuid NOT NULL, "status" "public"."subscriptions_status_enum" NOT NULL DEFAULT 'trial', "startDate" TIMESTAMP WITH TIME ZONE NOT NULL, "endDate" TIMESTAMP WITH TIME ZONE, "autoRenew" boolean NOT NULL DEFAULT false, "cancelledAt" TIMESTAMP WITH TIME ZONE, "quotaOverrides" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7a624398899f3b73f3c12f9955" ON "subscriptions" ("tenantId", "status") `);
        await queryRunner.query(`CREATE TABLE "tenants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "companyName" character varying NOT NULL, "logo_url" character varying, "domain" character varying, "phone" character varying, "address" character varying, "country" character varying, "language" character varying NOT NULL DEFAULT 'ar', "timezone" character varying NOT NULL DEFAULT 'UTC+3', "is_verified" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "UQ_21a472f60626f3568aac6661bb7" UNIQUE ("companyName"), CONSTRAINT "PK_53be67a04681c66b87ee27c9321" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."permissions_scope_enum" AS ENUM('system', 'tenant')`);
        await queryRunner.query(`CREATE TABLE "permissions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "displayNameAr" character varying, "scope" "public"."permissions_scope_enum" NOT NULL DEFAULT 'tenant', "tenant_id" uuid, CONSTRAINT "UQ_48ce552495d14eae9b187bb6716" UNIQUE ("name"), CONSTRAINT "PK_920331560282b8bd21bb02290df" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."roles_scope_enum" AS ENUM('system', 'tenant')`);
        await queryRunner.query(`CREATE TABLE "roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "scope" "public"."roles_scope_enum" NOT NULL DEFAULT 'tenant', "tenant_id" uuid, CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."employee_contracts_contracttype_enum" AS ENUM('دائم', 'جزئي', 'مرن', 'عن بعد', 'أخرى')`);
        await queryRunner.query(`CREATE TYPE "public"."employee_contracts_tickettype_enum" AS ENUM('بدون', 'ذهاب فقط', 'ذهاب وعودة')`);
        await queryRunner.query(`CREATE TYPE "public"."employee_contracts_probationperiod_enum" AS ENUM('بدون', '3 شهور', '6 شهور')`);
        await queryRunner.query(`CREATE TYPE "public"."employee_contracts_medicalinsurance_enum" AS ENUM('بدون', 'فردي', 'عائلي')`);
        await queryRunner.query(`CREATE TABLE "employee_contracts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "contractType" "public"."employee_contracts_contracttype_enum" NOT NULL DEFAULT 'دائم', "startDate" date NOT NULL, "endDate" date, "annualLeaveDays" integer NOT NULL DEFAULT '30', "contract_duration_years" integer, "ticketType" "public"."employee_contracts_tickettype_enum" DEFAULT 'بدون', "probationPeriod" "public"."employee_contracts_probationperiod_enum" DEFAULT 'بدون', "probationEndDate" date, "medicalInsurance" "public"."employee_contracts_medicalinsurance_enum" DEFAULT 'بدون', "nationality" character varying(100), "notes" text, "attachmentPaths" text, "employee_id" uuid NOT NULL, "tenant_id" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "REL_764f83b1ad1017c0210a5ab362" UNIQUE ("employee_id"), CONSTRAINT "PK_a04015bb4378a8825b52be4817d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."loans_status_enum" AS ENUM('pending', 'approved', 'rejected', 'completed')`);
        await queryRunner.query(`CREATE TABLE "loans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "totalAmount" numeric(12,2) NOT NULL, "installmentsCount" integer NOT NULL, "paidInstallments" integer NOT NULL DEFAULT '0', "monthlyInstallment" numeric(12,2) NOT NULL, "reason" text, "status" "public"."loans_status_enum" NOT NULL DEFAULT 'pending', "startDate" date NOT NULL, "employee_id" uuid NOT NULL, "tenant_id" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5c6942c1e13e4de135c5203ee61" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."advances_status_enum" AS ENUM('pending', 'approved', 'rejected', 'paid')`);
        await queryRunner.query(`CREATE TABLE "advances" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "amount" numeric(12,2) NOT NULL, "reason" text, "status" "public"."advances_status_enum" NOT NULL DEFAULT 'pending', "repaymentDate" date NOT NULL, "employee_id" uuid NOT NULL, "is_disbursed" boolean NOT NULL DEFAULT false, "disbursed_by_id" uuid, "disbursed_at" TIMESTAMP WITH TIME ZONE, "tenant_id" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_90025e8a76003358ed7c470050c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "shifts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "startTime" TIME NOT NULL, "endTime" TIME NOT NULL, "gracePeriod" integer NOT NULL DEFAULT '30', "tenant_id" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_84d692e367e4d6cdf045828768c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "employee_educations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "degree" character varying(255) NOT NULL, "certificate_number" character varying(100), "issuing_authority" character varying(255), "expiry_date" date, "attachment_path" character varying, "employee_id" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3755bc5568c47c9cd8ed2d468b9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "departments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "tenant_id" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_839517a681a86bb84cbcc6a1e9d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."bonuses_status_enum" AS ENUM('pending', 'approved', 'rejected', 'paid')`);
        await queryRunner.query(`CREATE TABLE "bonuses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "employee_id" uuid NOT NULL, "amount" numeric(12,2) NOT NULL, "payoutDate" date NOT NULL, "notes" text, "status" "public"."bonuses_status_enum" NOT NULL DEFAULT 'pending', "is_disbursed" boolean NOT NULL DEFAULT false, "disbursed_by_id" uuid, "disbursed_at" TIMESTAMP WITH TIME ZONE, "tenant_id" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_70d172c5a1bbe261fe01ff591fa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."deductions_status_enum" AS ENUM('pending', 'active', 'completed', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "deductions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "employee_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "totalAmount" numeric(12,2) NOT NULL, "startDate" date NOT NULL, "installmentsCount" integer NOT NULL DEFAULT '1', "monthlyAmount" numeric(12,2) NOT NULL, "paidInstallments" integer NOT NULL DEFAULT '0', "status" "public"."deductions_status_enum" NOT NULL DEFAULT 'pending', "notes" text, "tenant_id" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_bcf323939e22bf22386ecd4db7b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."end_of_service_reason_enum" AS ENUM('استقالة', 'فسخ عقد', 'انتهاء عقد', 'تقاعد', 'أخرى')`);
        await queryRunner.query(`CREATE TABLE "end_of_service" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "employee_id" uuid NOT NULL, "terminationDate" date NOT NULL, "reason" "public"."end_of_service_reason_enum" NOT NULL, "serviceYears" numeric(10,3) NOT NULL, "eosAmount" numeric(12,2) NOT NULL, "lastBasicSalary" numeric(12,2) NOT NULL, "payoutDate" date NOT NULL, "notes" text, "tenant_id" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_05d1a0f3e6de5c4b439e022cb33" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."resignation_requests_status_enum" AS ENUM('pending', 'approved', 'rejected', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "resignation_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "employee_id" uuid NOT NULL, "requestDate" date NOT NULL, "lastWorkingDay" date NOT NULL, "reason" text NOT NULL, "status" "public"."resignation_requests_status_enum" NOT NULL DEFAULT 'pending', "managerNotes" text, "decisionDate" TIMESTAMP WITH TIME ZONE, "tenant_id" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e28c42d0b8d41cd8d8d0f15d6a0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."salaries_paymentmethod_enum" AS ENUM('CASH', 'BANK')`);
        await queryRunner.query(`CREATE TABLE "salaries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "employee_id" uuid NOT NULL, "basicSalary" numeric(12,2) NOT NULL DEFAULT '0', "housingAllowance" numeric(12,2) NOT NULL DEFAULT '0', "transportAllowance" numeric(12,2) NOT NULL DEFAULT '0', "otherAllowances" numeric(12,2) NOT NULL DEFAULT '0', "totalSalary" numeric(12,2) NOT NULL, "paymentMethod" "public"."salaries_paymentmethod_enum" NOT NULL DEFAULT 'CASH', "iban" character varying(34), "tenant_id" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_20ca60aa8d4201c7bcb430fdb36" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "settlements" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "employee_id" uuid NOT NULL, "unused_leave_days" integer NOT NULL, "daily_rate" numeric(12,2) NOT NULL, "total_amount" numeric(12,2) NOT NULL, "settlement_date" date NOT NULL, "notes" text, "is_disbursed" boolean NOT NULL DEFAULT false, "disbursed_by_id" uuid, "disbursed_at" TIMESTAMP WITH TIME ZONE, "tenant_id" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5f523ce152b84e818bff9467aab" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."leave_requests_type_enum" AS ENUM('annual', 'unpaid', 'other')`);
        await queryRunner.query(`CREATE TYPE "public"."leave_requests_status_enum" AS ENUM('pending', 'approved', 'rejected')`);
        await queryRunner.query(`CREATE TABLE "leave_requests" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "employeeId" uuid NOT NULL, "startDate" date NOT NULL, "endDate" date NOT NULL, "type" "public"."leave_requests_type_enum" NOT NULL DEFAULT 'annual', "status" "public"."leave_requests_status_enum" NOT NULL DEFAULT 'pending', "reason" text, "tenant_id" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d3abcf9a16cef1450129e06fa9f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."employees_nationalitytype_enum" AS ENUM('saudi', 'non_saudi', 'outside_sponsorship')`);
        await queryRunner.query(`CREATE TYPE "public"."employees_status_enum" AS ENUM('active', 'inactive', 'terminated')`);
        await queryRunner.query(`CREATE TABLE "employees" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "fullName" character varying(255) NOT NULL, "employeeCode" character varying(50) NOT NULL, "nationalityType" "public"."employees_nationalitytype_enum" NOT NULL DEFAULT 'saudi', "iqamaExpiryDate" date, "nationalId" character varying, "nationalIdCardPath" character varying, "phone" character varying(20), "jobTitle" character varying(100), "department_id" uuid, "status" "public"."employees_status_enum" NOT NULL DEFAULT 'active', "shift_id" uuid, "tenant_id" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP, "user_id" uuid, CONSTRAINT "UQ_e3d0372d1ebe64cf827743666ce" UNIQUE ("employeeCode"), CONSTRAINT "REL_2d83c53c3e553a48dadb9722e3" UNIQUE ("user_id"), CONSTRAINT "PK_b9535a98350d5b26e7eb0c26af4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."users_status_enum" AS ENUM('active', 'inactive', 'suspended')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "username" character varying NOT NULL, "email" character varying NOT NULL, "password" character varying NOT NULL, "status" "public"."users_status_enum" NOT NULL DEFAULT 'active', "isSuperAdmin" boolean NOT NULL DEFAULT false, "isSystemAdmin" boolean NOT NULL DEFAULT false, "isEmailVerified" boolean NOT NULL DEFAULT false, "isDisclaimerAccepted" boolean NOT NULL DEFAULT false, "disclaimerAcceptedAt" TIMESTAMP, "resetPasswordToken" character varying, "resetPasswordExpires" TIMESTAMP, "tenant_id" uuid, "role_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "quotations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "quotationNumber" character varying NOT NULL, "invoiceNumber" character varying, "customerName" character varying NOT NULL, "customerPhone" character varying, "customerAddress" character varying, "items" jsonb NOT NULL DEFAULT '[]', "subTotal" numeric(10,2) NOT NULL DEFAULT '0', "taxAmount" numeric(10,2) NOT NULL DEFAULT '0', "grandTotal" numeric(10,2) NOT NULL DEFAULT '0', "notes" character varying, "bankAccounts" jsonb, "termsAndConditions" jsonb, "status" character varying NOT NULL DEFAULT 'draft', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_1abd99974f3059c04df9104a764" UNIQUE ("quotationNumber"), CONSTRAINT "UQ_49e6d8e97dfdd222ffbd9880aa5" UNIQUE ("invoiceNumber"), CONSTRAINT "PK_6c00eb8ba181f28c21ffba7ecb1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "payroll_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "payroll_id" uuid NOT NULL, "employee_id" uuid NOT NULL, "basicSalary" numeric(12,2) NOT NULL DEFAULT '0', "housing_allowance" numeric(12,2) NOT NULL DEFAULT '0', "transport_allowance" numeric(12,2) NOT NULL DEFAULT '0', "other_allowances" numeric(12,2) NOT NULL DEFAULT '0', "overtimeAmount" numeric(12,2) NOT NULL DEFAULT '0', "bonuses_amount" numeric(12,2) NOT NULL DEFAULT '0', "settlements_amount" numeric(12,2) NOT NULL DEFAULT '0', "eos_amount" numeric(12,2) NOT NULL DEFAULT '0', "prepaid_bonuses" numeric(12,2) NOT NULL DEFAULT '0', "prepaid_settlements" numeric(12,2) NOT NULL DEFAULT '0', "prepaid_allowances" numeric(12,2) NOT NULL DEFAULT '0', "loan_deduction" numeric(12,2) NOT NULL DEFAULT '0', "advance_deduction" numeric(12,2) NOT NULL DEFAULT '0', "unpaid_leave_deduction" numeric(12,2) NOT NULL DEFAULT '0', "other_deductions" numeric(12,2) NOT NULL DEFAULT '0', "netSalary" numeric(12,2) NOT NULL, "notes" text, CONSTRAINT "PK_c03d4c6f2f5fb77fc771c9c0ba4" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "payrolls" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "month" integer NOT NULL, "year" integer NOT NULL, "totalNetSalary" numeric(14,2) NOT NULL DEFAULT '0', "paymentDate" date NOT NULL, "is_disbursed" boolean NOT NULL DEFAULT false, "disbursed_by_id" uuid, "disbursed_at" TIMESTAMP WITH TIME ZONE, "tenant_id" uuid NOT NULL, "generatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_4fc19dcf3522661435565b5ecf3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."notifications_type_enum" AS ENUM('info', 'warning', 'error', 'success')`);
        await queryRunner.query(`CREATE TYPE "public"."notifications_category_enum" AS ENUM('contract_expiry', 'id_expiry', 'probation_end', 'custom', 'system', 'leave_approved', 'leave_rejected')`);
        await queryRunner.query(`CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying NOT NULL, "message" text NOT NULL, "type" "public"."notifications_type_enum" NOT NULL DEFAULT 'info', "category" "public"."notifications_category_enum" NOT NULL, "referenceId" character varying, "referenceType" character varying, "isRead" boolean NOT NULL DEFAULT false, "actionUrl" character varying, "metadata" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "expiresAt" TIMESTAMP, "recipient_id" uuid, CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "leave_balances" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "employee_id" uuid NOT NULL, "year" integer NOT NULL, "totalAllowance" integer NOT NULL DEFAULT '30', "consumedDays" integer NOT NULL DEFAULT '0', "accrual_start_date" date, "carried_over_days" numeric(10,3) NOT NULL DEFAULT '0', "tenant_id" character varying NOT NULL, CONSTRAINT "PK_a1d90dff48fb2bfd23a7163d077" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f16fd993a15ce20247bbbf8ee7" ON "leave_balances" ("tenant_id", "year") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_1941a7c4f4033b6f65cac690d4" ON "leave_balances" ("employee_id", "year") `);
        await queryRunner.query(`CREATE TYPE "public"."leave_balance_history_action_enum" AS ENUM('ACCRUAL', 'CONSUMPTION', 'CARRY_OVER', 'SETTLEMENT', 'ADJUSTMENT')`);
        await queryRunner.query(`CREATE TABLE "leave_balance_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "employee_id" character varying NOT NULL, "tenant_id" character varying NOT NULL, "action" "public"."leave_balance_history_action_enum" NOT NULL, "days_change" numeric(10,3) NOT NULL, "balance_after" numeric(10,3) NOT NULL, "reference_id" uuid, "cycle_year" integer, "notes" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c82f7d66e665e3778b108e378fd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_32abf12e72fd2d5ff209dcea13" ON "leave_balance_history" ("employee_id", "tenant_id", "action", "cycle_year") `);
        await queryRunner.query(`CREATE INDEX "IDX_439c625537e2940205a8a97765" ON "leave_balance_history" ("employee_id", "tenant_id") `);
        await queryRunner.query(`CREATE TYPE "public"."leave_audit_logs_old_status_enum" AS ENUM('pending', 'approved', 'rejected')`);
        await queryRunner.query(`CREATE TYPE "public"."leave_audit_logs_new_status_enum" AS ENUM('pending', 'approved', 'rejected')`);
        await queryRunner.query(`CREATE TYPE "public"."leave_audit_logs_action_type_enum" AS ENUM('STATUS_CHANGE', 'CREATED', 'DELETED')`);
        await queryRunner.query(`CREATE TABLE "leave_audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "leave_request_id" uuid NOT NULL, "changed_by_id" uuid, "old_status" "public"."leave_audit_logs_old_status_enum", "new_status" "public"."leave_audit_logs_new_status_enum" NOT NULL, "action_type" "public"."leave_audit_logs_action_type_enum" NOT NULL DEFAULT 'STATUS_CHANGE', "tenant_id" character varying NOT NULL, "notes" text, "timestamp" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e8c0087b0d48e2baec08dd6d4e0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_2349efed828738d58089ac7165" ON "leave_audit_logs" ("tenant_id", "timestamp") `);
        await queryRunner.query(`CREATE INDEX "IDX_890105416dae39cf024a40bbb3" ON "leave_audit_logs" ("leave_request_id", "timestamp") `);
        await queryRunner.query(`CREATE INDEX "IDX_6c8503a66476faa65ecad63637" ON "leave_audit_logs" ("leave_request_id") `);
        await queryRunner.query(`CREATE TABLE "device_commands" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "deviceId" character varying NOT NULL, "command" character varying NOT NULL, "isExecuted" boolean NOT NULL DEFAULT false, "tenantId" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_08a3f976a83bbf1754fbf4088c7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."biometric_devices_status_enum" AS ENUM('online', 'offline', 'disabled')`);
        await queryRunner.query(`CREATE TABLE "biometric_devices" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "serialNumber" character varying NOT NULL, "alias" character varying, "ipAddress" character varying, "location" character varying, "model" character varying, "status" "public"."biometric_devices_status_enum" NOT NULL DEFAULT 'offline', "last_seen_at" TIMESTAMP WITH TIME ZONE, "last_log_index" integer NOT NULL DEFAULT '0', "tenant_id" uuid NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_7c6b036caa41627295807785104" UNIQUE ("serialNumber"), CONSTRAINT "PK_e959efdfa762cf108f76611f5e8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_7c6b036caa4162729580778510" ON "biometric_devices" ("serialNumber") `);
        await queryRunner.query(`CREATE TYPE "public"."attendance_logs_punch_type_enum" AS ENUM('check_in', 'check_out', 'break_out', 'break_in', 'overtime_in', 'overtime_out', 'leave')`);
        await queryRunner.query(`CREATE TYPE "public"."attendance_logs_verify_mode_enum" AS ENUM('fingerprint', 'card', 'password', 'face', 'fingerprint_card', 'manual')`);
        await queryRunner.query(`CREATE TABLE "attendance_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "device_user_id" character varying NOT NULL, "employee_id" uuid, "device_id" uuid, "tenant_id" uuid NOT NULL, "punch_time" TIMESTAMP WITH TIME ZONE NOT NULL, "punch_type" "public"."attendance_logs_punch_type_enum" NOT NULL DEFAULT 'check_in', "verify_mode" "public"."attendance_logs_verify_mode_enum" NOT NULL DEFAULT 'fingerprint', "device_sn" character varying, "raw_log_id" character varying, "is_manual_entry" boolean NOT NULL DEFAULT false, "created_by_user_id" uuid, "created_by_name" character varying, "is_edited" boolean NOT NULL DEFAULT false, "edited_by_user_id" uuid, "edited_by_name" character varying, "edited_at" TIMESTAMP WITH TIME ZONE, "original_punch_time" TIMESTAMP WITH TIME ZONE, "leave_reason" text, "work_hours" numeric(6,2), "overtime_hours" numeric(6,2), "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e78c28cf950bd06d614ae09f26b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fe959b3953edbece64701544a1" ON "attendance_logs" ("employee_id", "punch_time") `);
        await queryRunner.query(`CREATE INDEX "IDX_343817eea1479352ab749cd19b" ON "attendance_logs" ("tenant_id", "punch_time") `);
        await queryRunner.query(`CREATE TABLE "roles_permissions_permissions" ("rolesId" uuid NOT NULL, "permissionsId" uuid NOT NULL, CONSTRAINT "PK_b2f4e3f7fbeb7e5b495dd819842" PRIMARY KEY ("rolesId", "permissionsId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_dc2b9d46195bb3ed28abbf7c9e" ON "roles_permissions_permissions" ("rolesId") `);
        await queryRunner.query(`CREATE INDEX "IDX_fd4d5d4c7f7ff16c57549b72c6" ON "roles_permissions_permissions" ("permissionsId") `);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_0c5fe8e5f9f4dd4a8c0134abc9c" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_7536cba909dd7584a4640cad7d5" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "permissions" ADD CONSTRAINT "FK_c9d5c0d09e27afdb707a2a8837b" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "roles" ADD CONSTRAINT "FK_e59a01f4fe46ebbece575d9a0fc" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "employee_contracts" ADD CONSTRAINT "FK_764f83b1ad1017c0210a5ab3624" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "loans" ADD CONSTRAINT "FK_c283021e393bbf9f04c4656b292" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "advances" ADD CONSTRAINT "FK_ee29c7bbafa210c81331bbeb75b" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "advances" ADD CONSTRAINT "FK_3554c56d89d0d752f6968631644" FOREIGN KEY ("disbursed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "employee_educations" ADD CONSTRAINT "FK_b0407c1a6cfaba5fbcb46129332" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "bonuses" ADD CONSTRAINT "FK_0268caef8e02b78548ed884c0e4" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "bonuses" ADD CONSTRAINT "FK_6bca30b03fcab795d33db2bc605" FOREIGN KEY ("disbursed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "bonuses" ADD CONSTRAINT "FK_896e81e4ab83aa17bfcda520f98" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "deductions" ADD CONSTRAINT "FK_de26ed7815e0d1932c30b54de62" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "deductions" ADD CONSTRAINT "FK_cd04111b04a537e8623b5509358" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "end_of_service" ADD CONSTRAINT "FK_4ef4eb239fb9a99118837b79fd9" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "end_of_service" ADD CONSTRAINT "FK_223c3d533936758b675b6859a6a" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "resignation_requests" ADD CONSTRAINT "FK_fcb6614758c3e3ba44e2151e148" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "resignation_requests" ADD CONSTRAINT "FK_ade4b5d973bf10e9ef7b54416a8" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "salaries" ADD CONSTRAINT "FK_9ac79195d31e77bb6df432eab13" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "settlements" ADD CONSTRAINT "FK_eea22b8f4be3a715a9c3659ec34" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "settlements" ADD CONSTRAINT "FK_6ed473ea3b753e6ed57e2ac0dfb" FOREIGN KEY ("disbursed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "leave_requests" ADD CONSTRAINT "FK_4eda1468756ca831495e308e407" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "employees" ADD CONSTRAINT "FK_678a3540f843823784b0fe4a4f2" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "employees" ADD CONSTRAINT "FK_2d83c53c3e553a48dadb9722e38" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "employees" ADD CONSTRAINT "FK_98e5075745ff16aeca79c12311c" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "employees" ADD CONSTRAINT "FK_588d18aeef0504067e40c682788" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_109638590074998bb72a2f2cf08" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_a2cecd1a3531c0b041e29ba46e1" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payroll_items" ADD CONSTRAINT "FK_569877eb7444c99a715f9cc521e" FOREIGN KEY ("payroll_id") REFERENCES "payrolls"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payroll_items" ADD CONSTRAINT "FK_b93e8155ef805b7ef6013634532" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payrolls" ADD CONSTRAINT "FK_7b78f7a161e51079a2d5578a9e1" FOREIGN KEY ("disbursed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payrolls" ADD CONSTRAINT "FK_d77ef12e0b5bb22d362769b946d" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "FK_5332a4daa46fd3f4e6625dd275d" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "leave_balances" ADD CONSTRAINT "FK_2f8aebce74941a2e2168e94ba68" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "leave_audit_logs" ADD CONSTRAINT "FK_6c8503a66476faa65ecad636370" FOREIGN KEY ("leave_request_id") REFERENCES "leave_requests"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "leave_audit_logs" ADD CONSTRAINT "FK_228b8296c900461d5f28d149caf" FOREIGN KEY ("changed_by_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "biometric_devices" ADD CONSTRAINT "FK_cdf8d80e7f05ca327f9e587cbd3" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" ADD CONSTRAINT "FK_c4ca4ff3d403535898ba7ae6ba3" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" ADD CONSTRAINT "FK_058526643ec7189b132892280c8" FOREIGN KEY ("device_id") REFERENCES "biometric_devices"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" ADD CONSTRAINT "FK_9686734a4d3009a0d5e9f1515ed" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "roles_permissions_permissions" ADD CONSTRAINT "FK_dc2b9d46195bb3ed28abbf7c9e3" FOREIGN KEY ("rolesId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "roles_permissions_permissions" ADD CONSTRAINT "FK_fd4d5d4c7f7ff16c57549b72c6f" FOREIGN KEY ("permissionsId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    /**
     * ⚠️ التراجع عن نقطة البداية = حذف كل جداول النظام وبياناته.
     * محمي عمداً حتى لا يُنفَّذ بالخطأ عبر migration:revert على قاعدة حقيقية.
     */
    public async down(queryRunner: QueryRunner): Promise<void> {
        if (process.env.ALLOW_BASELINE_REVERT !== 'true') {
            throw new Error(
                'Refusing to revert the baseline migration: it drops every table. ' +
                    'Set ALLOW_BASELINE_REVERT=true only on a disposable database.',
            );
        }

        await queryRunner.query(`ALTER TABLE "roles_permissions_permissions" DROP CONSTRAINT "FK_fd4d5d4c7f7ff16c57549b72c6f"`);
        await queryRunner.query(`ALTER TABLE "roles_permissions_permissions" DROP CONSTRAINT "FK_dc2b9d46195bb3ed28abbf7c9e3"`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" DROP CONSTRAINT "FK_9686734a4d3009a0d5e9f1515ed"`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" DROP CONSTRAINT "FK_058526643ec7189b132892280c8"`);
        await queryRunner.query(`ALTER TABLE "attendance_logs" DROP CONSTRAINT "FK_c4ca4ff3d403535898ba7ae6ba3"`);
        await queryRunner.query(`ALTER TABLE "biometric_devices" DROP CONSTRAINT "FK_cdf8d80e7f05ca327f9e587cbd3"`);
        await queryRunner.query(`ALTER TABLE "leave_audit_logs" DROP CONSTRAINT "FK_228b8296c900461d5f28d149caf"`);
        await queryRunner.query(`ALTER TABLE "leave_audit_logs" DROP CONSTRAINT "FK_6c8503a66476faa65ecad636370"`);
        await queryRunner.query(`ALTER TABLE "leave_balances" DROP CONSTRAINT "FK_2f8aebce74941a2e2168e94ba68"`);
        await queryRunner.query(`ALTER TABLE "notifications" DROP CONSTRAINT "FK_5332a4daa46fd3f4e6625dd275d"`);
        await queryRunner.query(`ALTER TABLE "payrolls" DROP CONSTRAINT "FK_d77ef12e0b5bb22d362769b946d"`);
        await queryRunner.query(`ALTER TABLE "payrolls" DROP CONSTRAINT "FK_7b78f7a161e51079a2d5578a9e1"`);
        await queryRunner.query(`ALTER TABLE "payroll_items" DROP CONSTRAINT "FK_b93e8155ef805b7ef6013634532"`);
        await queryRunner.query(`ALTER TABLE "payroll_items" DROP CONSTRAINT "FK_569877eb7444c99a715f9cc521e"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_a2cecd1a3531c0b041e29ba46e1"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_109638590074998bb72a2f2cf08"`);
        await queryRunner.query(`ALTER TABLE "employees" DROP CONSTRAINT "FK_588d18aeef0504067e40c682788"`);
        await queryRunner.query(`ALTER TABLE "employees" DROP CONSTRAINT "FK_98e5075745ff16aeca79c12311c"`);
        await queryRunner.query(`ALTER TABLE "employees" DROP CONSTRAINT "FK_2d83c53c3e553a48dadb9722e38"`);
        await queryRunner.query(`ALTER TABLE "employees" DROP CONSTRAINT "FK_678a3540f843823784b0fe4a4f2"`);
        await queryRunner.query(`ALTER TABLE "leave_requests" DROP CONSTRAINT "FK_4eda1468756ca831495e308e407"`);
        await queryRunner.query(`ALTER TABLE "settlements" DROP CONSTRAINT "FK_6ed473ea3b753e6ed57e2ac0dfb"`);
        await queryRunner.query(`ALTER TABLE "settlements" DROP CONSTRAINT "FK_eea22b8f4be3a715a9c3659ec34"`);
        await queryRunner.query(`ALTER TABLE "salaries" DROP CONSTRAINT "FK_9ac79195d31e77bb6df432eab13"`);
        await queryRunner.query(`ALTER TABLE "resignation_requests" DROP CONSTRAINT "FK_ade4b5d973bf10e9ef7b54416a8"`);
        await queryRunner.query(`ALTER TABLE "resignation_requests" DROP CONSTRAINT "FK_fcb6614758c3e3ba44e2151e148"`);
        await queryRunner.query(`ALTER TABLE "end_of_service" DROP CONSTRAINT "FK_223c3d533936758b675b6859a6a"`);
        await queryRunner.query(`ALTER TABLE "end_of_service" DROP CONSTRAINT "FK_4ef4eb239fb9a99118837b79fd9"`);
        await queryRunner.query(`ALTER TABLE "deductions" DROP CONSTRAINT "FK_cd04111b04a537e8623b5509358"`);
        await queryRunner.query(`ALTER TABLE "deductions" DROP CONSTRAINT "FK_de26ed7815e0d1932c30b54de62"`);
        await queryRunner.query(`ALTER TABLE "bonuses" DROP CONSTRAINT "FK_896e81e4ab83aa17bfcda520f98"`);
        await queryRunner.query(`ALTER TABLE "bonuses" DROP CONSTRAINT "FK_6bca30b03fcab795d33db2bc605"`);
        await queryRunner.query(`ALTER TABLE "bonuses" DROP CONSTRAINT "FK_0268caef8e02b78548ed884c0e4"`);
        await queryRunner.query(`ALTER TABLE "employee_educations" DROP CONSTRAINT "FK_b0407c1a6cfaba5fbcb46129332"`);
        await queryRunner.query(`ALTER TABLE "advances" DROP CONSTRAINT "FK_3554c56d89d0d752f6968631644"`);
        await queryRunner.query(`ALTER TABLE "advances" DROP CONSTRAINT "FK_ee29c7bbafa210c81331bbeb75b"`);
        await queryRunner.query(`ALTER TABLE "loans" DROP CONSTRAINT "FK_c283021e393bbf9f04c4656b292"`);
        await queryRunner.query(`ALTER TABLE "employee_contracts" DROP CONSTRAINT "FK_764f83b1ad1017c0210a5ab3624"`);
        await queryRunner.query(`ALTER TABLE "roles" DROP CONSTRAINT "FK_e59a01f4fe46ebbece575d9a0fc"`);
        await queryRunner.query(`ALTER TABLE "permissions" DROP CONSTRAINT "FK_c9d5c0d09e27afdb707a2a8837b"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_7536cba909dd7584a4640cad7d5"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_0c5fe8e5f9f4dd4a8c0134abc9c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fd4d5d4c7f7ff16c57549b72c6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dc2b9d46195bb3ed28abbf7c9e"`);
        await queryRunner.query(`DROP TABLE "roles_permissions_permissions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_343817eea1479352ab749cd19b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fe959b3953edbece64701544a1"`);
        await queryRunner.query(`DROP TABLE "attendance_logs"`);
        await queryRunner.query(`DROP TYPE "public"."attendance_logs_verify_mode_enum"`);
        await queryRunner.query(`DROP TYPE "public"."attendance_logs_punch_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7c6b036caa4162729580778510"`);
        await queryRunner.query(`DROP TABLE "biometric_devices"`);
        await queryRunner.query(`DROP TYPE "public"."biometric_devices_status_enum"`);
        await queryRunner.query(`DROP TABLE "device_commands"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_6c8503a66476faa65ecad63637"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_890105416dae39cf024a40bbb3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2349efed828738d58089ac7165"`);
        await queryRunner.query(`DROP TABLE "leave_audit_logs"`);
        await queryRunner.query(`DROP TYPE "public"."leave_audit_logs_action_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."leave_audit_logs_new_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."leave_audit_logs_old_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_439c625537e2940205a8a97765"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_32abf12e72fd2d5ff209dcea13"`);
        await queryRunner.query(`DROP TABLE "leave_balance_history"`);
        await queryRunner.query(`DROP TYPE "public"."leave_balance_history_action_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1941a7c4f4033b6f65cac690d4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f16fd993a15ce20247bbbf8ee7"`);
        await queryRunner.query(`DROP TABLE "leave_balances"`);
        await queryRunner.query(`DROP TABLE "notifications"`);
        await queryRunner.query(`DROP TYPE "public"."notifications_category_enum"`);
        await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
        await queryRunner.query(`DROP TABLE "payrolls"`);
        await queryRunner.query(`DROP TABLE "payroll_items"`);
        await queryRunner.query(`DROP TABLE "quotations"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_status_enum"`);
        await queryRunner.query(`DROP TABLE "employees"`);
        await queryRunner.query(`DROP TYPE "public"."employees_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."employees_nationalitytype_enum"`);
        await queryRunner.query(`DROP TABLE "leave_requests"`);
        await queryRunner.query(`DROP TYPE "public"."leave_requests_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."leave_requests_type_enum"`);
        await queryRunner.query(`DROP TABLE "settlements"`);
        await queryRunner.query(`DROP TABLE "salaries"`);
        await queryRunner.query(`DROP TYPE "public"."salaries_paymentmethod_enum"`);
        await queryRunner.query(`DROP TABLE "resignation_requests"`);
        await queryRunner.query(`DROP TYPE "public"."resignation_requests_status_enum"`);
        await queryRunner.query(`DROP TABLE "end_of_service"`);
        await queryRunner.query(`DROP TYPE "public"."end_of_service_reason_enum"`);
        await queryRunner.query(`DROP TABLE "deductions"`);
        await queryRunner.query(`DROP TYPE "public"."deductions_status_enum"`);
        await queryRunner.query(`DROP TABLE "bonuses"`);
        await queryRunner.query(`DROP TYPE "public"."bonuses_status_enum"`);
        await queryRunner.query(`DROP TABLE "departments"`);
        await queryRunner.query(`DROP TABLE "employee_educations"`);
        await queryRunner.query(`DROP TABLE "shifts"`);
        await queryRunner.query(`DROP TABLE "advances"`);
        await queryRunner.query(`DROP TYPE "public"."advances_status_enum"`);
        await queryRunner.query(`DROP TABLE "loans"`);
        await queryRunner.query(`DROP TYPE "public"."loans_status_enum"`);
        await queryRunner.query(`DROP TABLE "employee_contracts"`);
        await queryRunner.query(`DROP TYPE "public"."employee_contracts_medicalinsurance_enum"`);
        await queryRunner.query(`DROP TYPE "public"."employee_contracts_probationperiod_enum"`);
        await queryRunner.query(`DROP TYPE "public"."employee_contracts_tickettype_enum"`);
        await queryRunner.query(`DROP TYPE "public"."employee_contracts_contracttype_enum"`);
        await queryRunner.query(`DROP TABLE "roles"`);
        await queryRunner.query(`DROP TYPE "public"."roles_scope_enum"`);
        await queryRunner.query(`DROP TABLE "permissions"`);
        await queryRunner.query(`DROP TYPE "public"."permissions_scope_enum"`);
        await queryRunner.query(`DROP TABLE "tenants"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7a624398899f3b73f3c12f9955"`);
        await queryRunner.query(`DROP TABLE "subscriptions"`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_status_enum"`);
        await queryRunner.query(`DROP TABLE "plans"`);
        await queryRunner.query(`DROP TYPE "public"."plans_billingcycle_enum"`);
    }

}
