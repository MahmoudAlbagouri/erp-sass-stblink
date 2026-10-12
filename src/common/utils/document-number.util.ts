// src/common/utils/document-number.util.ts
import { EntityManager } from 'typeorm';

const DIGITS = 6;

/**
 * الرقم التسلسلي التالي لمستند داخل الشركة: TR-000001, TR-000002 ...
 *
 * يُستدعى داخل معاملة إنشاء المستند. القفل الاستشاري (حتى نهاية المعاملة)
 * يجعل طلبين متزامنين لنفس الشركة ونفس نوع المستند يأخذان رقمين مختلفين.
 *
 * `table` و `prefix` و `column` ثوابت من الكود (ليست مدخلات مستخدم).
 */
export async function nextDocumentNumber(
  manager: EntityManager,
  table: string,
  prefix: string,
  tenantId: string,
  column = 'number',
): Promise<string> {
  await lockDocumentSequence(manager, table, tenantId);

  const [row] = await manager.query<{ max: number | null }[]>(
    `SELECT MAX(CAST(SUBSTRING("${column}" FROM ${prefix.length + 1}) AS INTEGER)) AS "max"
       FROM "${table}"
      WHERE "tenantId" = $1 AND "${column}" ~ $2`,
    [tenantId, `^${prefix}[0-9]{1,9}$`],
  );

  const next = (Number(row?.max) || 0) + 1;
  return `${prefix}${String(next).padStart(DIGITS, '0')}`;
}

/**
 * يقفل تسلسل مستندات جدول لشركة حتى نهاية المعاملة (قفل استشاري). من يأخذ
 * رقماً أو يمدّ سلسلة مرتبطة بالترتيب (بصمات الفواتير) ينتظر دوره هنا.
 */
export async function lockDocumentSequence(
  manager: EntityManager,
  table: string,
  tenantId: string,
): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `${table}:${tenantId}`,
  ]);
}
