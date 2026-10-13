// src/common/utils/format.util.ts
// المصدر الوحيد لتنسيق الأرقام والتواريخ في التقارير والإشعارات (en-US).
import { getCurrencyDecimals, getCurrencySymbol } from '../constants/countries';

export const DISPLAY_LOCALE = 'en-US';

type DateInput = Date | string | number;

/**
 * تاريخ: 10/11/2026. `timeZone` (IANA) يعرضه بتوقيت الشركة؛ بدونه بتوقيت
 * السيرفر — مناسب فقط لتواريخ بلا وقت.
 */
export const formatDate = (value: DateInput, timeZone?: string): string =>
  new Date(value).toLocaleDateString(DISPLAY_LOCALE, { timeZone });

/** تاريخ ووقت: 10/11/2026, 3:45:00 PM — انظر `timeZone` في formatDate */
export const formatDateTime = (value: DateInput, timeZone?: string): string =>
  new Date(value).toLocaleString(DISPLAY_LOCALE, { timeZone });

/** رقم بفواصل الآلاف: 1,500 */
export const formatAmount = (
  value: number | string,
  options?: Intl.NumberFormatOptions,
): string => Number(value).toLocaleString(DISPLAY_LOCALE, options);

/** مبلغ بعملة الشركة (ISO 4217): 1,500 ر.س */
export const formatMoney = (
  value: number | string,
  currency?: string | null,
): string => {
  // خانات العملة كاملة دائماً: 1,500.00 ر.س / 1,500.000 د.ك
  const decimals = getCurrencyDecimals(currency);
  const amount = formatAmount(value, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${amount} ${getCurrencySymbol(currency)}`;
};
