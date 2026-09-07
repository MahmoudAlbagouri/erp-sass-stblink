// src/modules/shifts/utils/shift-time.util.ts

/**
 * تحويل نص وقت بصيغة "HH:mm" إلى عدد الدقائق منذ منتصف الليل
 */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  return h * 60 + (m || 0);
}

export interface ShiftWindow {
  startMinutes: number;
  endMinutes: number;
  /** true لو الشيفت بيعبر منتصف الليل (مثال: 22:00 -> 06:00) */
  isOvernight: boolean;
  durationMinutes: number;
  graceMinutes: number;
}

/**
 * يحلل بيانات الشيفت (بداية/نهاية/سماحية) ويكتشف هل هو شيفت ليلي أم لا،
 * ويحسب مدته الفعلية بالدقائق بغض النظر عن عبوره لمنتصف الليل.
 */
export function getShiftWindow(shift: {
  startTime: string;
  endTime: string;
  gracePeriod?: number;
}): ShiftWindow {
  const startMinutes = toMinutes(shift.startTime);
  const endMinutes = toMinutes(shift.endTime);
  const isOvernight = endMinutes <= startMinutes;
  const durationMinutes = isOvernight
    ? 24 * 60 - startMinutes + endMinutes
    : endMinutes - startMinutes;

  return {
    startMinutes,
    endMinutes,
    isOvernight,
    durationMinutes,
    graceMinutes: shift.gracePeriod ?? 30,
  };
}

/**
 * يحسب الفرق بالدقائق بين وقت فعلي ووقت مرجعي (كلاهما "دقيقة في اليوم"،
 * أي من 0 إلى 1439)، مع تصحيح الالتفاف حول منتصف الليل بالنسبة للشيفتات الليلية.
 *
 * مثال: شيفت ليلي ينتهي الساعة 06:00 (=360)، وموظف بصم انصراف الساعة 23:50 (=1430)
 * بدون هذا التصحيح هيطلع إنه "انصرف بدري بـ 1070 دقيقة" وهو غلط، والمفروض
 * يترجم لكونه انصرف قبل نهاية الشيفت الفعلي بفارق منطقي بعد لف الساعة.
 */
export function diffMinutesOvernightAware(
  actualMinutes: number,
  referenceMinutes: number,
  isOvernight: boolean,
): number {
  let diff = actualMinutes - referenceMinutes;
  if (isOvernight) {
    if (diff > 12 * 60) diff -= 24 * 60;
    if (diff < -12 * 60) diff += 24 * 60;
  }
  return diff;
}
