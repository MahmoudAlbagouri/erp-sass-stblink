// src/common/utils/timezone.util.ts
// التعامل مع الوقت المحلي للشركة: كل الأوقات تُخزَّن لحظات UTC حقيقية، وتُحوَّل
// من/إلى توقيت الشركة (IANA) عند الحدود فقط — قراءة ساعة جهاز، حساب "يوم" أو
// "وردية"، وعرض تقرير. لا شيء هنا يعتمد على المنطقة الزمنية للسيرفر.
import { DateTime, IANAZone } from 'luxon';
import type { EntityManager } from 'typeorm';
import { getCountry } from '../constants/countries';

const DAY_FORMAT = 'yyyy-MM-dd';

export function isValidTimezone(zone?: string | null): zone is string {
  return !!zone && IANAZone.isValidZone(zone);
}

/** المنطقة الزمنية للشركة؛ قيمة غير صالحة أو غائبة ← منطقة دولتها */
export async function tenantTimezoneOf(
  manager: EntityManager,
  tenantId: string,
): Promise<string> {
  const rows: { timezone: string | null; country: string | null }[] =
    await manager.query(
      `SELECT "timezone", "country" FROM tenants WHERE "id" = $1`,
      [tenantId],
    );
  const row = rows[0];
  return isValidTimezone(row?.timezone)
    ? row.timezone
    : getCountry(row?.country).timezone;
}

/**
 * وقت محلي بلا منطقة ("2026-10-13 08:05:00" كما تعرضه ساعة جهاز البصمة) إلى
 * لحظته الحقيقية. يعيد null لنص غير صالح.
 *
 * ساعة لا وجود لها (لحظة تقديم التوقيت الصيفي) تُزاح للأمام، والساعة المكررة
 * (لحظة تأخيره) تُحسب بالتوقيت الأسبق — سلوك luxon الافتراضي.
 */
export function zonedTimeToUtc(wallTime: string, zone: string): Date | null {
  const parsed = DateTime.fromISO(wallTime.trim().replace(' ', 'T'), { zone });
  return parsed.isValid ? parsed.toJSDate() : null;
}

/** بداية يوم (YYYY-MM-DD) في منطقة زمنية، كلحظة UTC. null لتاريخ غير صالح */
export function startOfDayInZone(day: string, zone: string): Date | null {
  const parsed = DateTime.fromFormat(day.slice(0, 10), DAY_FORMAT, { zone });
  return parsed.isValid ? parsed.startOf('day').toJSDate() : null;
}

/** لحظة = بداية اليوم في المنطقة + عدد دقائق (قد يتجاوز 24 ساعة أو يكون سالباً) */
export function dayOffsetInZone(
  day: string,
  minutes: number,
  zone: string,
): Date {
  return DateTime.fromFormat(day.slice(0, 10), DAY_FORMAT, { zone })
    .startOf('day')
    .plus({ minutes })
    .toJSDate();
}

/** اليوم (YYYY-MM-DD) الذي تقع فيه اللحظة بتوقيت المنطقة */
export function dayKeyInZone(date: Date, zone: string): string {
  return DateTime.fromJSDate(date, { zone }).toFormat(DAY_FORMAT);
}

/** دقيقة اليوم (0–1439) للّحظة بتوقيت المنطقة */
export function minutesOfDayInZone(date: Date, zone: string): number {
  const local = DateTime.fromJSDate(date, { zone });
  return local.hour * 60 + local.minute;
}

/** فرق المنطقة عن UTC بالدقائق عند لحظة معينة (يتغير مع التوقيت الصيفي) */
export function utcOffsetMinutes(zone: string, at: Date = new Date()): number {
  return DateTime.fromJSDate(at, { zone }).offset;
}

/** "2026-10-13 08:05:00" بتوقيت المنطقة — الصيغة التي تتبادلها أجهزة البصمة */
export function formatWallTime(date: Date, zone: string): string {
  return DateTime.fromJSDate(date, { zone }).toFormat('yyyy-MM-dd HH:mm:ss');
}
