// src/modules/notifications/notification-types.ts
// سجل أنواع الإشعارات: المصدر الوحيد لاسم كل نوع ومجموعته وأيقونته وهل
// يملك المستخدم كتمه. الواجهة تقرؤه من GET /notifications/types فلا تكرره.
//
// نوع جديد = سطر هنا، ثم notify({ type: '<key>', ... }) من مستمع أو فاحص.

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'danger';

export const NOTIFICATION_SEVERITIES: NotificationSeverity[] = [
  'info',
  'success',
  'warning',
  'danger',
];

export const NOTIFICATION_GROUPS = {
  messages: 'رسائل الإدارة',
  requests: 'الطلبات',
  hr: 'شؤون الموظفين',
  payroll: 'الرواتب والمستحقات',
  attendance: 'الحضور',
  inventory: 'المخزون',
  finance: 'المبيعات والمشتريات',
  pos: 'نقاط البيع',
  accounting: 'المحاسبة',
  subscription: 'الاشتراك',
  system: 'النظام',
} as const;

export type NotificationGroup = keyof typeof NOTIFICATION_GROUPS;

export interface NotificationTypeDef {
  label: string;
  group: NotificationGroup;
  /** اسم أيقونة lucide (kebab-case) */
  icon: string;
  /** false: إشعار لا يُكتم (رسائل الإدارة، الاشتراك) */
  mutable: boolean;
}

const type = (
  label: string,
  group: NotificationGroup,
  icon: string,
  mutable = true,
): NotificationTypeDef => ({ label, group, icon, mutable });

export const NOTIFICATION_TYPES = {
  // رسائل الإدارة
  manager_message: type('رسالة من الإدارة', 'messages', 'megaphone', false),

  // الطلبات: الجديد منها لمن يعتمدها، والقرار لصاحبها
  leave_request: type('طلب إجازة جديد', 'requests', 'calendar-plus'),
  leave_decision: type('قرار طلب الإجازة', 'requests', 'calendar-check'),
  advance_request: type('طلب سلفة جديد', 'requests', 'hand-coins'),
  advance_decision: type('قرار طلب السلفة', 'requests', 'hand-coins'),
  loan_request: type('طلب قرض جديد', 'requests', 'landmark'),
  loan_decision: type('قرار طلب القرض', 'requests', 'landmark'),
  resignation_request: type('طلب استقالة', 'requests', 'log-out'),
  resignation_decision: type('قرار طلب الاستقالة', 'requests', 'file-check'),

  // شؤون الموظفين
  contract_expiry: type('انتهاء عقد', 'hr', 'file-text'),
  iqama_expiry: type('انتهاء إقامة', 'hr', 'id-card'),
  probation_end: type('انتهاء فترة التجربة', 'hr', 'user-check'),
  contract_renewed: type('تجديد عقد', 'hr', 'file-check'),
  employee_onboarded: type('موظف جديد', 'hr', 'user-plus'),
  welcome: type('مرحباً بك', 'hr', 'sparkles', false),

  // الرواتب والمستحقات
  payroll_paid: type('صرف الراتب', 'payroll', 'wallet'),
  bonus: type('مكافأة', 'payroll', 'gift'),
  deduction: type('خصم من الراتب', 'payroll', 'circle-minus'),
  advance_paid: type('تسليم سلفة', 'payroll', 'banknote'),
  settlement: type('تسوية رصيد إجازة', 'payroll', 'scale'),

  // الحضور
  attendance_change: type('تعديل الحضور', 'attendance', 'fingerprint'),
  device_offline: type('جهاز بصمة منقطع', 'attendance', 'wifi-off'),
  device_security: type('أمان أجهزة البصمة', 'attendance', 'shield-alert'),

  // المخزون
  low_stock: type('نقص المخزون', 'inventory', 'package-x'),
  stock_transfer: type('تحويل مخزني', 'inventory', 'truck'),

  // المبيعات والمشتريات
  customer_overdue: type('فواتير عملاء متأخرة', 'finance', 'receipt'),
  supplier_due: type('مستحقات موردين', 'finance', 'calendar-clock'),

  // نقاط البيع
  cash_variance: type('فرق في درج الكاشير', 'pos', 'coins'),

  // المحاسبة
  posting_errors: type('تعذّر ترحيل قيود', 'accounting', 'book-x'),

  // الاشتراك والمنصة
  subscription: type('الاشتراك', 'subscription', 'crown', false),
  tenant_registered: type('شركة جديدة', 'system', 'building-2'),
  general: type('عام', 'system', 'info'),
} satisfies Record<string, NotificationTypeDef>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export const isNotificationType = (key: string): key is NotificationType =>
  Object.prototype.hasOwnProperty.call(NOTIFICATION_TYPES, key);

/** أنواع يملك المستخدم كتمها */
export const isMutableType = (key: string): boolean =>
  isNotificationType(key) && NOTIFICATION_TYPES[key].mutable;
