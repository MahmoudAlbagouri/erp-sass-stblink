// ============================================
// STB ERP - Type Definitions
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  statusCode: number;
  data: T;
}

export interface Tenant {
  id: string;
  company_name: string;
  logo_url: string | null;
  domain: string | null;
  phone: string;
  address: string;
  country: string | null;
  subscription_plan: 'free' | 'basic' | 'pro' | 'enterprise';
  status: 'trial' | 'active' | 'suspended' | 'expired';
  trial_ends_at: string | null;
  subscription_ends_at: string | null;
  max_users: number;
  storage_limit_mb: number;
  language: string;
  timezone: string;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Permission {
  id: string;
  name: string;
  scope: 'system' | 'tenant';
  tenantId: string | null;
}

export interface Role {
  id: string;
  name: string;
  scope: 'system' | 'tenant';
  tenantId: string | null;
  permissions?: Permission[];
}

export interface User {
  id: string;
  username: string;
  email: string;
  status: 'active' | 'inactive' | 'suspended';
  isSuperAdmin: boolean;
  isSystemAdmin: boolean;
  isEmailVerified: boolean;
  tenantId: string;
  roleId: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  role?: Role | null;
  tenant?: Tenant;
}

export interface Employee {
  id: string;
  fullName: string;
  employeeCode: string;
  nationalId?: string | null;
  nationalIdCardPath?: string | null;
  phone: string | null;
  jobTitle: string | null;
  department: string | null;
  hireDate: string | null;
  status: 'active' | 'inactive' | 'terminated';
  tenantId: string;
  shiftId?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  user?: User | null;
  contract?: any; // يمكن تعريف نوع العقد لاحقاً
}

// --- Auth ---
export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  companyName: string;
  phone?: string;
  address?: string;
  username: string;
  email: string;
  password: string;
}

export interface AuthTokens {
  userId: string;
  email: string;
  tenantId: string;
  isSuperAdmin: boolean;
  isSystemAdmin: boolean;
  accessToken: string;
  refreshToken: string;
}

export interface RefreshedTokens {
  accessToken: string;
  refreshToken: string;
}

// --- Forms ---
export interface CreateUserPayload {
  username: string;
  email: string;
  password: string;
  roleId?: string;
}

export interface UpdateUserPayload {
  username?: string;
  email?: string;
  status?: 'active' | 'inactive' | 'suspended';
  roleId?: string;
}

export interface CreateRolePayload {
  name: string;
  scope?: 'system' | 'tenant';
  permissionIds: string[];
}

export interface UpdateRolePayload {
  name?: string;
  permissionIds?: string[];
}

export interface CreatePermissionPayload {
  name: string;
  scope?: 'system' | 'tenant';
}

export interface CreateEmployeePayload {
  fullName: string;
  employeeCode: string;
  nationalId?: string;
  nationalIdCardPath?: string;
  phone?: string;
  jobTitle?: string;
  department?: string;
  hireDate?: string;
  status?: 'active' | 'inactive' | 'terminated';
  userId?: string;
}

export interface UpdateEmployeePayload {
  fullName?: string;
  employeeCode?: string;
  nationalId?: string;
  nationalIdCardPath?: string;
  phone?: string;
  jobTitle?: string;
  department?: string;
  hireDate?: string;
  status?: 'active' | 'inactive' | 'terminated';
}

// --- Toast ---
export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}
