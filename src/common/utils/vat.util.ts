// src/common/utils/vat.util.ts
// هل الشركة مسجّلة في ضريبة القيمة المضافة؟
//
// منشأة غير مسجّلة (في السعودية: إيراد سنوي أقل من حد التسجيل الإلزامي) لا
// تحصّل ضريبة، ولا تصدر "فاتورة ضريبية"، ولا تطبع رقماً ضريبياً ولا رمز QR، ولا
// تسترد ضريبة مشترياتها (فتدخل في تكلفة البضاعة). الإعداد في sales_settings
// (vatRegistered)؛ شركة لم تفتح إعداداتها بعد: حسب دولتها (لا ضريبة في
// الكويت وقطر…).
import type { EntityManager } from 'typeorm';
import { getCountry } from '../constants/countries';

/** الافتراضي قبل أن تحفظ الشركة إعداداتها: مسجّلة إن كان في دولتها ضريبة */
export async function defaultVatRegistered(
  manager: EntityManager,
  tenantId: string,
): Promise<boolean> {
  const rows: { country: string | null }[] = await manager.query(
    `SELECT "country" FROM tenants WHERE "id" = $1`,
    [tenantId],
  );
  return getCountry(rows[0]?.country).vatRate > 0;
}

export async function vatRegisteredOf(
  manager: EntityManager,
  tenantId: string,
): Promise<boolean> {
  const rows: { vatRegistered: boolean }[] = await manager.query(
    `SELECT "vatRegistered" FROM sales_settings WHERE "tenantId" = $1`,
    [tenantId],
  );
  return rows[0]
    ? rows[0].vatRegistered
    : defaultVatRegistered(manager, tenantId);
}
