// src/common/utils/format.util.ts
// المصدر الوحيد لتنسيق الأرقام والتواريخ في التقارير والإشعارات (en-US).

export const DISPLAY_LOCALE = 'en-US';

type DateInput = Date | string | number;

/** تاريخ: 10/11/2026 */
export const formatDate = (value: DateInput): string =>
  new Date(value).toLocaleDateString(DISPLAY_LOCALE);

/** تاريخ ووقت: 10/11/2026, 3:45:00 PM */
export const formatDateTime = (value: DateInput): string =>
  new Date(value).toLocaleString(DISPLAY_LOCALE);

/** رقم بفواصل الآلاف: 1,500 */
export const formatAmount = (
  value: number | string,
  options?: Intl.NumberFormatOptions,
): string => Number(value).toLocaleString(DISPLAY_LOCALE, options);
