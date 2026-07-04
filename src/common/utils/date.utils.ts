// src/common/utils/date.utils.ts
import { Injectable } from '@nestjs/common';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * DateUtils — المصدر الوحيد للحقيقة لحساب الأيام في كامل النظام.
 *
 * ✅ يحل مشكلة الأخطاء بفارق يوم واحد (Off-by-one) الناتجة عن وجود
 *    دالتين منفصلتين (calendarDays و daysInclusive) بمنطق مختلف قليلاً
 *    في LeaveAccrualService القديمة.
 *
 * يجب على LeavesService و LeaveAccrualService و SettlementsService و
 * LeaveCarryoverCronService استخدام هذه الخدمة حصرياً لأي حساب أيام،
 * ولا يجوز إعادة تعريف منطق حساب التواريخ في أي مكان آخر.
 */
@Injectable()
export class DateUtils {
  /** يُطبّع أي Date/string إلى منتصف الليل المحلي (بدون وقت) لتفادي أخطاء الفاصلة الزمنية/التوقيت الصيفي */
  private normalize(date: Date | string): Date {
    const d = date instanceof Date ? date : new Date(date);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /**
   * الدالة الموحدة الوحيدة لحساب عدد الأيام بين تاريخين.
   *
   * @param startDate تاريخ البداية
   * @param endDate تاريخ النهاية
   * @param isInclusive
   *   - true: يُحسب اليومان معاً (مناسب لطول إجازة "من تاريخ إلى تاريخ"،
   *     مثلاً 1 إلى 3 يناير = 3 أيام).
   *   - false: يُحسب الفارق الزمني الصافي فقط (مناسب لحساب "مدة الخدمة"
   *     بين تاريخ التعيين وتاريخ اليوم — وهو مفهوم زمني وليس "شامل").
   */
  calculateDurationDays(
    startDate: Date | string,
    endDate: Date | string,
    isInclusive: boolean,
  ): number {
    const start = this.normalize(startDate);
    const end = this.normalize(endDate);

    const diff = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
    const days = isInclusive ? diff + 1 : diff;

    return Math.max(days, 0);
  }

  /**
   * يُرجع عدد أيام التقاطع (Clip) بين فترة إجازة وفترة مرجعية [from, to]،
   * محسوبة بشكل شامل (inclusive) — تُستخدم لتقييد أيام الإجازة غير مدفوعة
   * الأجر على نافذة زمنية معينة (مثلاً حتى "اليوم").
   */
  clipDaysToPeriod(
    periodStart: Date | string,
    periodEnd: Date | string,
    from: Date | string,
    to: Date | string,
  ): number {
    const pStart = this.normalize(periodStart);
    const pEnd = this.normalize(periodEnd);
    const f = this.normalize(from);
    const t = this.normalize(to);

    const clippedStart = pStart > f ? pStart : f;
    const clippedEnd = pEnd < t ? pEnd : t;

    if (clippedStart > clippedEnd) return 0;
    return this.calculateDurationDays(clippedStart, clippedEnd, true);
  }

  /** يُرجع تاريخ "ذكرى التعيين" لسنة مُحددة، بناءً على شهر/يوم تاريخ العقد الأصلي */
  anniversaryForYear(originalDate: Date | string, year: number): Date {
    const d = this.normalize(originalDate);
    return new Date(year, d.getMonth(), d.getDate());
  }

  isSameOrBefore(a: Date | string, b: Date | string): boolean {
    return this.normalize(a).getTime() <= this.normalize(b).getTime();
  }
}
