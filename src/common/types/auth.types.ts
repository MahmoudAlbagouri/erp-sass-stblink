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
}

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
}

export type AuthenticatedRequest = Request & { user: CurrentUserData };
