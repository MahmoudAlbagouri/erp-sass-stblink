import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * الملفات المرفوعة في جدول واحد يُفتح برابط موقَّع (docs/modules/files.md)،
 * بدل مسارات/روابط نصية تُخدَّم من /uploads لأي أحد:
 *
 * - files: الملف وشركته ونوعه ومساره على القرص.
 * - employees.national_id_card_file_id و employee_educations.attachment_file_id
 *   و products."imageFileId": إشارة لملف بدل نص المسار.
 * - employee_contract_attachments: مرفقات العقد (كانت نصاً مفصولاً بفواصل).
 *
 * الملفات لا تُنقل على القرص: يُسجَّل لكل مسار قديم ملف بالمسار نفسه داخل
 * uploads. القيم القديمة روابط كاملة بالدومين (https://…/uploads//contract/…)
 * أو مسارات ناقصة (/contract/…)؛ يُستخرج من كلٍّ المسار داخل uploads. رابط لموقع
 * خارجي (ليس من uploads) لا يُنقل.
 */

/** المسار داخل uploads من القيمة القديمة */
const keyOf = (column: string) =>
  `ltrim(regexp_replace(trim(${column}), '^https?://[^/]+/uploads/+', ''), '/')`;

/** يُنقل فقط ما بقي مساراً داخلياً سليماً */
const MOVABLE = `src.key <> '' AND src.key !~ '^[a-zA-Z]+:' AND src.key !~ '\\.\\.'`;

const FILE_COLUMNS = `id, "tenantId", category, "storageKey", "originalName", "mimeType"`;
// tenant_id في بعض الجداول نص (employee_contracts)، وفي files uuid
const fileValues = (
  category: string,
) => `src.file_id, src.tenant_id::uuid, '${category}', src.key,
  regexp_replace(src.key, '^.*/', ''),
  CASE lower(substring(src.key from '\\.([^./]+)$'))
    WHEN 'pdf' THEN 'application/pdf'
    WHEN 'png' THEN 'image/png'
    WHEN 'webp' THEN 'image/webp'
    WHEN 'gif' THEN 'image/gif'
    WHEN 'jpg' THEN 'image/jpeg'
    WHEN 'jpeg' THEN 'image/jpeg'
    WHEN 'jfif' THEN 'image/jpeg'
    WHEN 'jpe' THEN 'image/jpeg'
    ELSE 'application/octet-stream'
  END`;

/** ملف واحد لكل سجل: يُنشأ في files ويُربط بعمود السجل الجديد */
const moveSingle = (opts: {
  table: string;
  from: string;
  tenant: string;
  oldColumn: string;
  newColumn: string;
  category: string;
}) => `
  WITH src AS MATERIALIZED (
    SELECT t.id AS owner_id, ${opts.tenant} AS tenant_id,
           uuid_generate_v4() AS file_id, ${keyOf(`t.${opts.oldColumn}`)} AS key
      FROM ${opts.from}
     WHERE coalesce(trim(t.${opts.oldColumn}), '') <> ''
  ), moved AS (
    INSERT INTO "files" (${FILE_COLUMNS})
    SELECT ${fileValues(opts.category)} FROM src WHERE ${MOVABLE}
    RETURNING id
  )
  UPDATE ${opts.table} t SET ${opts.newColumn} = src.file_id
    FROM src WHERE src.owner_id = t.id AND src.file_id IN (SELECT id FROM moved)`;

export class FilesStorage1793274528353 implements MigrationInterface {
  name = 'FilesStorage1793274528353';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── الجداول والأعمدة الجديدة
    await queryRunner.query(
      `CREATE TABLE "files" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenantId" uuid NOT NULL, "category" character varying(20) NOT NULL, "storageKey" character varying(300) NOT NULL, "originalName" character varying(255) NOT NULL, "mimeType" character varying(100) NOT NULL, "size" integer, "uploadedById" uuid, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6c16b9093a142e0e7613b04a3d9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e712c6e69ce63570ccb1b5957" ON "files" ("tenantId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "employee_contract_attachments" ("contract_id" uuid NOT NULL, "file_id" uuid NOT NULL, CONSTRAINT "PK_0040b061ef7557856dac9e4a6c2" PRIMARY KEY ("contract_id", "file_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1559497dc246a156fba0966c79" ON "employee_contract_attachments" ("contract_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cfe6e0ae3fdd187075671a86b7" ON "employee_contract_attachments" ("file_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" ADD "national_id_card_file_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_educations" ADD "attachment_file_id" uuid`,
    );
    await queryRunner.query(`ALTER TABLE "products" ADD "imageFileId" uuid`);

    // ── نقل المسارات القديمة إلى files
    await queryRunner.query(
      moveSingle({
        table: '"employees"',
        from: '"employees" t',
        tenant: 't.tenant_id',
        oldColumn: '"nationalIdCardPath"',
        newColumn: 'national_id_card_file_id',
        category: 'employee',
      }),
    );
    await queryRunner.query(
      moveSingle({
        table: '"employee_educations"',
        from: '"employee_educations" t JOIN "employees" e ON e.id = t.employee_id',
        tenant: 'e.tenant_id',
        oldColumn: 'attachment_path',
        newColumn: 'attachment_file_id',
        category: 'employee',
      }),
    );
    await queryRunner.query(
      moveSingle({
        table: '"products"',
        from: '"products" t',
        tenant: 't."tenantId"',
        oldColumn: '"imagePath"',
        newColumn: '"imageFileId"',
        category: 'product',
      }),
    );
    // مرفقات العقد: نص مفصول بفواصل (simple-array) ← صف لكل ملف
    await queryRunner.query(`
      WITH src AS MATERIALIZED (
        SELECT c.id AS owner_id, c.tenant_id AS tenant_id,
               uuid_generate_v4() AS file_id, ${keyOf('p.path')} AS key
          FROM "employee_contracts" c
          CROSS JOIN LATERAL unnest(string_to_array(c."attachmentPaths", ',')) AS p(path)
         WHERE coalesce(trim(p.path), '') <> ''
      ), moved AS (
        INSERT INTO "files" (${FILE_COLUMNS})
        SELECT ${fileValues('contract')} FROM src WHERE ${MOVABLE}
        RETURNING id
      )
      INSERT INTO "employee_contract_attachments" (contract_id, file_id)
      SELECT src.owner_id, src.file_id FROM src
       WHERE src.file_id IN (SELECT id FROM moved)`);

    // ── الأعمدة القديمة ثم القيود
    await queryRunner.query(
      `ALTER TABLE "employees" DROP COLUMN "nationalIdCardPath"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_educations" DROP COLUMN "attachment_path"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_contracts" DROP COLUMN "attachmentPaths"`,
    );
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "imagePath"`);

    await queryRunner.query(
      `ALTER TABLE "files" ADD CONSTRAINT "FK_269610c73dc40cbf3e07e689b25" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_educations" ADD CONSTRAINT "FK_159ab7cd7039de3531a19f2ee82" FOREIGN KEY ("attachment_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" ADD CONSTRAINT "FK_f8246e2e9e11ace546efaea42c3" FOREIGN KEY ("national_id_card_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD CONSTRAINT "FK_8ca6ae05d06030bac1a0c7dd0c9" FOREIGN KEY ("imageFileId") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_contract_attachments" ADD CONSTRAINT "FK_1559497dc246a156fba0966c792" FOREIGN KEY ("contract_id") REFERENCES "employee_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_contract_attachments" ADD CONSTRAINT "FK_cfe6e0ae3fdd187075671a86b7c" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  /** يعيد المسارات نصاً (/<المسار داخل uploads>) كما كان النظام القديم يخزّنها */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "employees" ADD "nationalIdCardPath" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_educations" ADD "attachment_path" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_contracts" ADD "attachmentPaths" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD "imagePath" character varying`,
    );

    await queryRunner.query(
      `UPDATE "employees" t SET "nationalIdCardPath" = '/' || f."storageKey" FROM "files" f WHERE f.id = t.national_id_card_file_id`,
    );
    await queryRunner.query(
      `UPDATE "employee_educations" t SET attachment_path = '/' || f."storageKey" FROM "files" f WHERE f.id = t.attachment_file_id`,
    );
    await queryRunner.query(
      `UPDATE "products" t SET "imagePath" = '/' || f."storageKey" FROM "files" f WHERE f.id = t."imageFileId"`,
    );
    await queryRunner.query(
      `UPDATE "employee_contracts" c SET "attachmentPaths" = agg.paths
         FROM (SELECT a.contract_id, string_agg('/' || f."storageKey", ',' ORDER BY f."createdAt") AS paths
                 FROM "employee_contract_attachments" a JOIN "files" f ON f.id = a.file_id
                GROUP BY a.contract_id) agg
        WHERE agg.contract_id = c.id`,
    );

    await queryRunner.query(
      `ALTER TABLE "employee_contract_attachments" DROP CONSTRAINT "FK_cfe6e0ae3fdd187075671a86b7c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_contract_attachments" DROP CONSTRAINT "FK_1559497dc246a156fba0966c792"`,
    );
    await queryRunner.query(
      `ALTER TABLE "products" DROP CONSTRAINT "FK_8ca6ae05d06030bac1a0c7dd0c9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employees" DROP CONSTRAINT "FK_f8246e2e9e11ace546efaea42c3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_educations" DROP CONSTRAINT "FK_159ab7cd7039de3531a19f2ee82"`,
    );
    await queryRunner.query(
      `ALTER TABLE "files" DROP CONSTRAINT "FK_269610c73dc40cbf3e07e689b25"`,
    );
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "imageFileId"`);
    await queryRunner.query(
      `ALTER TABLE "employees" DROP COLUMN "national_id_card_file_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "employee_educations" DROP COLUMN "attachment_file_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cfe6e0ae3fdd187075671a86b7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1559497dc246a156fba0966c79"`,
    );
    await queryRunner.query(`DROP TABLE "employee_contract_attachments"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e712c6e69ce63570ccb1b5957"`,
    );
    await queryRunner.query(`DROP TABLE "files"`);
  }
}
