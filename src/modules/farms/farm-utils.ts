// src/modules/farms/farm-utils.ts
// حسابات المزارع بلا قاعدة: مساحة المضلع على سطح الأرض، وقت الجهاز في
// الميدان، وتواريخ الأيام.
import { BadRequestException } from '@nestjs/common';
import type { GeoRing } from './entities/farm.entity';

/** نصف قطر الأرض (WGS84) بالمتر */
const EARTH_RADIUS = 6378137;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * مساحة مضلع على الكرة بالمتر المربع (صيغة Chamberlain & Duquette — نفس ما
 * تستعمله مكتبات الخرائط). الخطأ أقل من 0.5% لمزرعة بأي حجم معقول.
 */
export function ringAreaM2(ring: GeoRing): number {
  const n = ring.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % n];
    total += rad(lng2 - lng1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return (
    Math.round(Math.abs((total * EARTH_RADIUS * EARTH_RADIUS) / 2) * 100) / 100
  );
}

/**
 * يتحقق من حدود مرسومة ويعيدها نظيفة: 3 نقاط على الأقل، كل نقطة [طول، عرض]
 * بمدى صحيح، وبلا تكرار للنقطة الأولى في آخرها (يُغلق المضلع ضمناً).
 */
export function normalizeRing(
  input: unknown,
  label = 'الحدود',
): GeoRing | null {
  if (input === null || input === undefined) return null;
  if (!Array.isArray(input)) {
    throw new BadRequestException(`${label}: قائمة نقاط [طول، عرض]`);
  }
  const ring: GeoRing = [];
  for (const point of input) {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      typeof point[0] !== 'number' ||
      typeof point[1] !== 'number' ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1]) ||
      Math.abs(point[0]) > 180 ||
      Math.abs(point[1]) > 90
    ) {
      throw new BadRequestException(
        `${label}: كل نقطة [خط الطول، خط العرض] بأرقام صحيحة`,
      );
    }
    ring.push([round6(point[0]), round6(point[1])]);
  }
  const [first] = ring;
  const last = ring[ring.length - 1];
  if (ring.length > 3 && first[0] === last[0] && first[1] === last[1]) {
    ring.pop();
  }
  if (ring.length < 3) {
    throw new BadRequestException(`${label}: ارسم 3 نقاط على الأقل`);
  }
  return ring;
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/** هامش ساعة الجهاز للأمام قبل اعتبارها خاطئة */
const CLOCK_SKEW_MS = 5 * 60_000;

/**
 * وقت حدث سجّله جهاز (ISO). غائب أو غير صالح = الآن، وساعة جهاز في المستقبل
 * تُقصّ إلى الآن — ما وقع في الميدان لا يُرفض بسبب ساعة الجوال.
 */
export function deviceTime(iso?: string | null, now = new Date()): Date {
  if (!iso) return now;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return now;
  return at.getTime() > now.getTime() + CLOCK_SKEW_MS ? now : at;
}

/** يوم (YYYY-MM-DD) + أيام، بلا تأثر بالمنطقة الزمنية */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** أيام بين يومين (b − a) */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

/** يوم من شهر ويوم في سنة (31 فبراير ← آخر فبراير) */
export function dayOfYear(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const date = new Date(Date.UTC(year, month - 1, Math.min(day, last)));
  return date.toISOString().slice(0, 10);
}

/** خطأ تكرار فهرس فريد (رفع نفس العملية من جهازين في نفس اللحظة) */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  );
}
