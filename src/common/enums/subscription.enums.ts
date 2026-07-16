// src/common/enums/subscription.enums.ts
export enum BillingCycle {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
  LIFETIME = 'lifetime',
}

export enum SubscriptionStatus {
  TRIAL = 'trial',
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  SUSPENDED = 'suspended', // إيقاف يدوي من System Admin (مثلاً بسبب تأخر دفع)
  PENDING = 'pending', // بانتظار التفعيل/الدفع
}
