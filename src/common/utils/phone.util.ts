// src/common/utils/phone.util.ts
import type { CountryConfig } from '../constants/countries';

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/**
 * يوحّد رقم هاتف إلى الصيغة الدولية E.164 (‎+9665XXXXXXXX) حسب دولة الشركة.
 *
 * يقبل الرقم محلياً (05XXXXXXXX)، أو بمفتاح الدولة (+966 / 00966 / 966)، مع
 * مسافات وشرطات وأرقام هندية. يعيد null إذا لم يكن رقماً صالحاً لتلك الدولة.
 */
export function normalizePhone(
  raw: string,
  country: CountryConfig,
): string | null {
  const text = raw
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .trim();
  if (!/^\+?[\d\s\-().]+$/.test(text)) return null;

  const international = text.startsWith('+') || text.startsWith('00');
  let digits = text.replace(/\D/g, '');
  if (text.startsWith('00')) digits = digits.slice(2);

  const [min, max] = country.phoneLength;
  let national: string;
  if (international) {
    if (!digits.startsWith(country.dialCode)) return null;
    national = digits.slice(country.dialCode.length);
  } else if (
    digits.startsWith(country.dialCode) &&
    digits.length > max + 1 // أطول من أي رقم محلي: المفتاح مكتوب بلا +
  ) {
    national = digits.slice(country.dialCode.length);
  } else {
    national = digits;
  }

  // صفر الاتصال المحلي (05… / 010…) ليس جزءاً من الرقم الدولي
  national = national.replace(/^0+/, '');
  if (national.length < min || national.length > max) return null;

  return `+${country.dialCode}${national}`;
}
