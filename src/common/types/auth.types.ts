// src/common/types/auth.types.ts
import type { Request } from 'express';

/** صلاحية كما تُخزَّن داخل الـ JWT */
export interface AuthPermission {
  name: string;
  scope?: string;
  tenantId?: string;
}

/** الدور كما يُخزَّن داخل الـ JWT */
export interface AuthRole {
  id: string;
  name: string;
  scope?: string;
  permissions?: AuthPermission[];
}

/** محتوى الـ JWT (Access / Refresh) */
export interface JwtPayload {
  sub: string;
  tenantId?: string;
  isSuperAdmin: boolean;
  isSystemAdmin: boolean;
  isDisclaimerAccepted?: boolean;
  employeeId?: string;
  role?: AuthRole | null;
  /**
   * وضع الدعم: معرّف مالك النظام الذي يعمل داخل هذه الشركة بهذا التوكن.
   * يغيب في التوكنات العادية.
   */
  supportBy?: string;
  /** إعدادات دولة الشركة (تغيب عن مالك النظام) — انظر common/constants/countries */
  country?: string;
  currency?: string;
  timezone?: string;
  /**
   * الفروع المقيَّد بها المستخدم. غائبة أو فارغة = كل الفروع.
   * انظر modules/branches/branch-scope.
   */
  branchIds?: string[];
}

/** إعدادات دولة الشركة كما تُحمَل داخل التوكن */
export type TenantLocale = Required<
  Pick<JwtPayload, 'country' | 'currency' | 'timezone'>
>;

/**
 * المصدر الوحيد لشكل request.user في كامل النظام
 * (ناتج AccessTokenStrategy.validate).
 *
 * ملاحظة: tenantId يكون فارغاً لمالك النظام (isSystemAdmin) فقط.
 */
export interface CurrentUserData {
  id: string;
  tenantId: string;
  isSuperAdmin: boolean;
  isSystemAdmin: boolean;
  isDisclaimerAccepted?: boolean;
  employeeId?: string;
  role?: AuthRole | null;
  /** أسماء الصلاحيات فقط (مشتقة من role.permissions) */
  permissions?: string[];
  /** وضع الدعم: مالك النظام الذي يعمل داخل الشركة (انظر JwtPayload) */
  supportBy?: string;
  country?: string;
  /** عملة الشركة ISO 4217 */
  currency?: string;
  timezone?: string;
  /** الفروع المقيَّد بها (فارغة = كل الفروع) */
  branchIds?: string[];
}

export type AuthenticatedRequest = Request & { user: CurrentUserData };
