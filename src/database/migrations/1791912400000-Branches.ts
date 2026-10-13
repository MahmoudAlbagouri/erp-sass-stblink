import { MigrationInterface, QueryRunner } from 'typeorm';

const MAIN_BRANCH = 'الفرع الرئيسي';

/**
 * كيان «الفرع» فوق المخازن: للفرع مخازنه وموظفوه وأجهزته ومستخدموه.
 *
 * ترحيل البيانات القائمة يحافظ على ما كان يظهر قبلها («كل مخزن = فرع»):
 * - لكل شركة فرع رئيسي، يتبعه مخزنها الرئيسي ويأخذ عنوانه وهاتفه.
 * - كل مخزن آخر يصير فرعاً باسمه (وكوده وعنوانه وهاتفه وحالته)، والمخزن تابع له.
 * - المخازن المحذوفة تتبع الفرع الرئيسي (لا يُنشأ فرع لمخزن محذوف).
 * - كل الموظفين وأجهزة البصمة يُنسبون للفرع الرئيسي (لم يكن لهم فرع).
 * - سند القبض يأخذ فرع فاتورته أو مرتجعه، وإلا الرئيسي.
 * - لا يُقيَّد أي مستخدم بفروع: الكل يرى ما كان يراه.
 *
 * لا يعدّل أي فاتورة أو حركة: فرع المستند يُعرف من مخزنه.
 */
export class Branches1791912400000 implements MigrationInterface {
  name = 'Branches1791912400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ─── الجداول والأعمدة ───
    await queryRunner.query(
      `CREATE TABLE "branches" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "name" character varying(120) NOT NULL, "code" character varying(20), "address" character varying(300), "phone" character varying(30), "isMain" boolean NOT NULL DEFAULT false, "isActive" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_7f37d3b42defea97f1df0d19535" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_19db6a12993aa421cc98437663" ON "branches" ("tenantId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_2dc690f038f8256568c4054fab" ON "branches" ("tenantId") WHERE "isMain" = true AND "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_2c252fd421a1991c245c6ad256" ON "branches" ("tenantId", "name") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_branches" ("user_id" uuid NOT NULL, "branch_id" uuid NOT NULL, CONSTRAINT "PK_79e020eef929e23dfdd6f9b8720" PRIMARY KEY ("user_id", "branch_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a93a8dec13e6204974dd67386e" ON "user_branches" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7252d91dd610730c97d6b58ae7" ON "user_branches" ("branch_id") `,
    );
    await queryRunner.query(`ALTER TABLE "employees" ADD "branch_id" uuid`);
    // يُملأ أدناه ثم يصير NOT NULL
    await queryRunner.query(`ALTER TABLE "warehouses" ADD "branchId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "customer_payments" ADD "branchId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "biometric_devices" ADD "branch_id" uuid`,
    );

    // ─── ترحيل البيانات ───
    // فرع رئيسي لكل شركة، بعنوان وهاتف مخزنها الرئيسي إن وُجد
    await queryRunner.query(
      `INSERT INTO "branches" ("tenantId", "name", "isMain", "address", "phone")
       SELECT tenant."id", $1, true, LEFT(main."address", 300), main."phone"
         FROM "tenants" tenant
         LEFT JOIN "warehouses" main
                ON main."tenantId" = tenant."id" AND main."type" = 'main'
               AND main."deletedAt" IS NULL`,
      [MAIN_BRANCH],
    );
    // فرع لكل مخزن آخر. مخزن يحمل اسم الفرع الرئيسي نفسه يُميَّز اسم فرعه
    await queryRunner.query(
      `INSERT INTO "branches" ("tenantId", "name", "code", "address", "phone", "isActive")
       SELECT warehouse."tenantId",
              CASE WHEN warehouse."name" = $1
                   THEN LEFT(warehouse."name", 110) || ' (مخزن)'
                   ELSE LEFT(warehouse."name", 120) END,
              warehouse."code", LEFT(warehouse."address", 300),
              warehouse."phone", warehouse."isActive"
         FROM "warehouses" warehouse
        WHERE warehouse."type" <> 'main' AND warehouse."deletedAt" IS NULL`,
      [MAIN_BRANCH],
    );
    await queryRunner.query(
      `UPDATE "warehouses" warehouse SET "branchId" = branch."id"
         FROM "branches" branch
        WHERE branch."tenantId" = warehouse."tenantId" AND branch."isMain" = false
          AND warehouse."type" <> 'main' AND warehouse."deletedAt" IS NULL
          AND branch."name" = CASE WHEN warehouse."name" = $1
                                   THEN LEFT(warehouse."name", 110) || ' (مخزن)'
                                   ELSE LEFT(warehouse."name", 120) END`,
      [MAIN_BRANCH],
    );
    // الباقي (المخزن الرئيسي والمخازن المحذوفة) يتبع الفرع الرئيسي
    await queryRunner.query(
      `UPDATE "warehouses" warehouse SET "branchId" = branch."id"
         FROM "branches" branch
        WHERE branch."tenantId" = warehouse."tenantId" AND branch."isMain" = true
          AND warehouse."branchId" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "employees" employee SET "branch_id" = branch."id"
         FROM "branches" branch
        WHERE branch."tenantId" = employee."tenant_id" AND branch."isMain" = true`,
    );
    await queryRunner.query(
      `UPDATE "biometric_devices" device SET "branch_id" = branch."id"
         FROM "branches" branch
        WHERE branch."tenantId" = device."tenant_id" AND branch."isMain" = true`,
    );
    await queryRunner.query(
      `UPDATE "customer_payments" payment SET "branchId" = warehouse."branchId"
         FROM "sales_invoices" invoice
         JOIN "warehouses" warehouse ON warehouse."id" = invoice."warehouseId"
        WHERE invoice."id" = payment."invoiceId"`,
    );
    await queryRunner.query(
      `UPDATE "customer_payments" payment SET "branchId" = warehouse."branchId"
         FROM "sales_returns" ret
         JOIN "warehouses" warehouse ON warehouse."id" = ret."warehouseId"
        WHERE ret."id" = payment."salesReturnId" AND payment."branchId" IS NULL`,
    );
    await queryRunner.query(
      `UPDATE "customer_payments" payment SET "branchId" = branch."id"
         FROM "branches" branch
        WHERE branch."tenantId" = payment."tenantId" AND branch."isMain" = true
          AND payment."branchId" IS NULL`,
    );

    // ─── القيود ───
    await queryRunner.query(
      `ALTER TABLE "warehouses" ALTER COLUMN "branchId" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fd5307cafd46ace80ecf08edd2" ON "warehouses" ("tenantId", "branchId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5d36a9a8f935d27151fa02a729" ON "customer_payments" ("tenantId", "branchId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" ADD CONSTRAINT "FK_19db6a12993aa421cc984376635" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" ADD CONSTRAINT "FK_457a39c666de2686596e502eb8c" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "warehouses" ADD CONSTRAINT "FK_301b6e12e4ffe7fc38f2e22170d" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "biometric_devices" ADD CONSTRAINT "FK_8d21aa2acac868ce1dc93a3a545" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_branches" ADD CONSTRAINT "FK_a93a8dec13e6204974dd67386ed" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_branches" ADD CONSTRAINT "FK_7252d91dd610730c97d6b58ae79" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_branches" DROP CONSTRAINT "FK_7252d91dd610730c97d6b58ae79"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_branches" DROP CONSTRAINT "FK_a93a8dec13e6204974dd67386ed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "biometric_devices" DROP CONSTRAINT "FK_8d21aa2acac868ce1dc93a3a545"`,
    );
    await queryRunner.query(
      `ALTER TABLE "warehouses" DROP CONSTRAINT "FK_301b6e12e4ffe7fc38f2e22170d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" DROP CONSTRAINT "FK_457a39c666de2686596e502eb8c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "branches" DROP CONSTRAINT "FK_19db6a12993aa421cc984376635"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5d36a9a8f935d27151fa02a729"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fd5307cafd46ace80ecf08edd2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "biometric_devices" DROP COLUMN "branch_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customer_payments" DROP COLUMN "branchId"`,
    );
    await queryRunner.query(`ALTER TABLE "warehouses" DROP COLUMN "branchId"`);
    await queryRunner.query(`ALTER TABLE "employees" DROP COLUMN "branch_id"`);
    await queryRunner.query(`DROP TABLE "user_branches"`);
    await queryRunner.query(`DROP TABLE "branches"`);
  }
}
