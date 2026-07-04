// src/modules/leaves/config/leave-policy.config.ts
import { Injectable } from '@nestjs/common';

export type CreditLimitMode = 'FIXED_DAYS' | 'PERCENT_OF_ANNUAL';

export interface LeavePolicy {
  /** نمط حساب "الهامش الائتماني" المسموح به عند طلب إجازة تتجاوز الرصيد المكتسب فعلياً */
  creditLimitMode: CreditLimitMode;
  /** يُستخدم إذا كان creditLimitMode = FIXED_DAYS (مثال: 5 أيام إضافية) */
  creditLimitFixedDays: number;
  /** يُستخدم إذا كان creditLimitMode = PERCENT_OF_ANNUAL (مثال: 0.5 = 50% من سقف العقد السنوي) */
  creditLimitPercent: number;
  /** أقصى عدد أيام يمكن ترحيلها تراكمياً من سنة لأخرى */
  maxCarryOverDays: number;
  /** أقصى عدد سنوات إلى الوراء يفحصها الـ Cron عند الـ Backfilling (حماية من حلقات طويلة لعقود قديمة جداً) */
  maxBackfillYears: number;
}

/**
 * إعدادات سياسة الإجازات، قابلة للضبط عبر متغيرات البيئة دون الحاجة لتعديل الكود:
 *
 *   LEAVE_CREDIT_LIMIT_MODE=FIXED_DAYS | PERCENT_OF_ANNUAL
 *   LEAVE_CREDIT_LIMIT_FIXED_DAYS=5
 *   LEAVE_CREDIT_LIMIT_PERCENT=0.5
 *   LEAVE_MAX_CARRYOVER_DAYS=30
 *   LEAVE_MAX_BACKFILL_YEARS=10
 *
 * ملاحظة: إن رغبت مستقبلاً بجعل السياسة قابلة للتخصيص لكل Tenant على حدة
 * (بدلاً من إعداد عام للنظام)، يمكن تحويل get() لتقبل tenantId وتقرأ من
 * جدول إعدادات بدلاً من process.env دون تغيير أي كود يستهلك هذه الخدمة.
 */
@Injectable()
export class LeavePolicyService {
  private readonly policy: LeavePolicy = {
    creditLimitMode:
      (process.env.LEAVE_CREDIT_LIMIT_MODE as CreditLimitMode) ?? 'FIXED_DAYS',
    creditLimitFixedDays: Number(
      process.env.LEAVE_CREDIT_LIMIT_FIXED_DAYS ?? 5,
    ),
    creditLimitPercent: Number(process.env.LEAVE_CREDIT_LIMIT_PERCENT ?? 0.5),
    maxCarryOverDays: Number(process.env.LEAVE_MAX_CARRYOVER_DAYS ?? 30),
    maxBackfillYears: Number(process.env.LEAVE_MAX_BACKFILL_YEARS ?? 10),
  };

  get(): LeavePolicy {
    return this.policy;
  }
}
