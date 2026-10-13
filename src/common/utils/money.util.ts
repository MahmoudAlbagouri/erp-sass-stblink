// src/common/utils/money.util.ts
// تقريب المبالغ حسب عملة الشركة: خانتان لأغلب العملات، وثلاث للدينار
// (الكويت، البحرين، الأردن، العراق، تونس، ليبيا) والريال العُماني.
import Decimal from 'decimal.js';
import type { EntityManager } from 'typeorm';
import { getCurrencyDecimals } from '../constants/countries';

/** أقصى خانات عشرية لأي عملة مدعومة — وهي دقة أعمدة المبالغ في قاعدة البيانات */
export const MAX_MONEY_DECIMALS = 3;

/** مبلغ مقرَّب لخانات العملة (نصف لأعلى) */
export function roundMoney(value: Decimal.Value, decimals: number): number {
  return new Decimal(value).toDecimalPlaces(decimals).toNumber();
}

/**
 * عدد خانات عملة الشركة. يُقرأ عند بداية كل عملية تحسب مبالغ (فاتورة، مسير
 * رواتب…) ثم يُمرَّر لدوال الحساب: الشركات المختلفة تُقرَّب مبالغها بشكل مختلف.
 */
export async function moneyDecimalsOf(
  manager: EntityManager,
  tenantId: string,
): Promise<number> {
  const rows: { currency: string }[] = await manager.query(
    `SELECT "currency" FROM tenants WHERE "id" = $1`,
    [tenantId],
  );
  return getCurrencyDecimals(rows[0]?.currency);
}
