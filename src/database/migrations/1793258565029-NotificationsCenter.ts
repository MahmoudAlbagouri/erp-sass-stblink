import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * مركز الإشعارات (docs/modules/notifications.md):
 *
 * - notifications: محتوى الإشعار مرة واحدة (نوع من السجل، تفاصيل، رابط، مرسل،
 *   مفتاح منع تكرار فريد).
 * - notification_recipients: وصوله لكل مستخدم وحالته عنده (قرأ، أكّد، أخفى).
 * - notification_preferences: الأنواع التي كتمها المستخدم.
 * - notification_alert_states: حالات قائمة يُنبَّه بها مرة (صنف تحت الحد...).
 *
 * البيانات القديمة تُنقل بلا المكرر منها (التكرار كان من تشغيل كل مهمة دورية
 * مرتين). تنبيهات الانتهاء القديمة لا تُنقل: الفحص الجديد يعيد إنشاءها بمراحلها
 * ومستلميها الصحيحين.
 */
export class NotificationsCenter1793258565029 implements MigrationInterface {
  name = 'NotificationsCenter1793258565029';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── الجدول القديم جانباً (ونفس اسم المفتاح الأساسي يعود للجدول الجديد)
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "FK_5332a4daa46fd3f4e6625dd275d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" RENAME TO "notifications_legacy"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications_legacy" RENAME CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" TO "PK_notifications_legacy"`,
    );

    // ── الجداول الجديدة
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid, "type" character varying(60) NOT NULL, "severity" character varying(16) NOT NULL DEFAULT 'info', "title" character varying(200) NOT NULL, "body" text NOT NULL, "details" jsonb NOT NULL DEFAULT '[]', "data" jsonb NOT NULL DEFAULT '{}', "entityType" character varying(40), "entityId" character varying(64), "link" character varying(300), "senderId" uuid, "requiresAck" boolean NOT NULL DEFAULT false, "dedupeKey" character varying(200), "recipientCount" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expiresAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4e652c0d7bd0781daccfea1e11" ON "notifications" ("dedupeKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_97a4b8699af03b7372a511ce3d" ON "notifications" ("tenantId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "notification_recipients" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "notificationId" uuid NOT NULL, "userId" uuid NOT NULL, "tenantId" uuid, "readAt" TIMESTAMP WITH TIME ZONE, "acknowledgedAt" TIMESTAMP WITH TIME ZONE, "hiddenAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_bd5b25c456987261a38c762b223" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4248540e027df049f9bd5a2981" ON "notification_recipients" ("tenantId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e44c2d367992c2485f15eb5196" ON "notification_recipients" ("userId") WHERE "readAt" IS NULL AND "hiddenAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c7539413bcf723ab28b1e5faa9" ON "notification_recipients" ("userId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_53cfd1bfedccc676fd6d74137b" ON "notification_recipients" ("notificationId", "userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "notification_preferences" ("userId" uuid NOT NULL, "mutedTypes" jsonb NOT NULL DEFAULT '[]', "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b70c44e8b00757584a393225593" PRIMARY KEY ("userId"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "notification_alert_states" ("key" character varying(200) NOT NULL, "tenantId" uuid NOT NULL, "raisedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_688601d8dc7ffc74922055b39bd" PRIMARY KEY ("key"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e5fdadea8e0770754623831788" ON "notification_alert_states" ("tenantId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "notification_recipients" ADD CONSTRAINT "FK_234adaa36f97dd1b2bd3a22d65b" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification_recipients" ADD CONSTRAINT "FK_452385a8220b8053ab65317ffa6" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_d5b86bc522af7cc9e3e13960ffb" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_ddb7981cf939fe620179bfea33a" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification_preferences" ADD CONSTRAINT "FK_b70c44e8b00757584a393225593" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // ── نقل البيانات: نسخة واحدة من كل مكرر (الأقدم)، لمستخدم ما زال موجوداً
    await queryRunner.query(`
            INSERT INTO "notifications"
                ("id", "tenantId", "type", "severity", "title", "body", "data",
                 "entityType", "entityId", "link", "recipientCount", "createdAt", "expiresAt")
            SELECT DISTINCT ON (l."recipient_id", l."category", l."referenceId", l."title", l."message")
                l."id",
                u."tenant_id",
                CASE
                    WHEN l."category" IN ('leave_approved', 'leave_rejected') THEN 'leave_decision'
                    WHEN l."referenceType" = 'attendance' THEN 'attendance_change'
                    WHEN l."referenceType" = 'employee' THEN 'employee_onboarded'
                    ELSE 'general'
                END,
                CASE l."type"::text
                    WHEN 'warning' THEN 'warning'
                    WHEN 'error' THEN 'danger'
                    WHEN 'success' THEN 'success'
                    ELSE 'info'
                END,
                left(l."title", 200),
                l."message",
                COALESCE(l."metadata", '{}'::jsonb),
                left(l."referenceType", 40),
                left(l."referenceId", 64),
                CASE
                    WHEN l."actionUrl" IS NULL THEN NULL
                    WHEN l."actionUrl" LIKE '/dashboard%' THEN left(l."actionUrl", 300)
                    ELSE left('/dashboard' || l."actionUrl", 300)
                END,
                1,
                l."createdAt",
                l."expiresAt"
            FROM "notifications_legacy" l
            JOIN "users" u ON u."id" = l."recipient_id"
            WHERE l."category"::text NOT IN ('contract_expiry', 'id_expiry', 'probation_end')
            ORDER BY l."recipient_id", l."category", l."referenceId", l."title", l."message", l."createdAt"
        `);
    await queryRunner.query(`
            INSERT INTO "notification_recipients"
                ("notificationId", "userId", "tenantId", "readAt", "createdAt")
            SELECT n."id", l."recipient_id", n."tenantId",
                   CASE WHEN l."isRead" THEN n."createdAt" END, n."createdAt"
            FROM "notifications" n
            JOIN "notifications_legacy" l ON l."id" = n."id"
        `);

    await queryRunner.query(`DROP TABLE "notifications_legacy"`);
    await queryRunner.query(`DROP TYPE "public"."notifications_category_enum"`);
    await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notification_preferences" DROP CONSTRAINT "FK_b70c44e8b00757584a393225593"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "FK_ddb7981cf939fe620179bfea33a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "FK_d5b86bc522af7cc9e3e13960ffb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification_recipients" DROP CONSTRAINT "FK_452385a8220b8053ab65317ffa6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification_recipients" DROP CONSTRAINT "FK_234adaa36f97dd1b2bd3a22d65b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" RENAME TO "notifications_v2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications_v2" RENAME CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" TO "PK_notifications_v2"`,
    );

    // الشكل القديم: سطر لكل مستلم
    await queryRunner.query(
      `CREATE TYPE "public"."notifications_type_enum" AS ENUM('info', 'warning', 'error', 'success')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notifications_category_enum" AS ENUM('contract_expiry', 'id_expiry', 'probation_end', 'custom', 'system', 'leave_approved', 'leave_rejected')`,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying NOT NULL, "message" text NOT NULL, "type" "public"."notifications_type_enum" NOT NULL DEFAULT 'info', "category" "public"."notifications_category_enum" NOT NULL, "referenceId" character varying, "referenceType" character varying, "isRead" boolean NOT NULL DEFAULT false, "actionUrl" character varying, "metadata" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "expiresAt" TIMESTAMP, "recipient_id" uuid, CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`
            INSERT INTO "notifications"
                ("title", "message", "type", "category", "referenceId", "referenceType",
                 "isRead", "actionUrl", "metadata", "createdAt", "expiresAt", "recipient_id")
            SELECT n."title", n."body",
                   (CASE n."severity" WHEN 'danger' THEN 'error' WHEN 'warning' THEN 'warning'
                        WHEN 'success' THEN 'success' ELSE 'info' END)::"public"."notifications_type_enum",
                   (CASE n."type" WHEN 'contract_expiry' THEN 'contract_expiry'
                        WHEN 'iqama_expiry' THEN 'id_expiry' WHEN 'probation_end' THEN 'probation_end'
                        ELSE 'custom' END)::"public"."notifications_category_enum",
                   n."entityId", n."entityType", r."readAt" IS NOT NULL, n."link", n."data",
                   n."createdAt", n."expiresAt", r."userId"
            FROM "notifications_v2" n
            JOIN "notification_recipients" r ON r."notificationId" = n."id"
            WHERE r."hiddenAt" IS NULL
        `);
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_5332a4daa46fd3f4e6625dd275d" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_e5fdadea8e0770754623831788"`,
    );
    await queryRunner.query(`DROP TABLE "notification_alert_states"`);
    await queryRunner.query(`DROP TABLE "notification_preferences"`);
    await queryRunner.query(`DROP TABLE "notification_recipients"`);
    await queryRunner.query(`DROP TABLE "notifications_v2"`);
  }
}
