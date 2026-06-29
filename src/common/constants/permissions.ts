// src/common/constants/permissions.ts
import { PermissionMetadata } from '../decorators/permissions.decorator';

export const PERMS: Record<string, PermissionMetadata> = {
  // ─── Users ─────────────────────────────────────────
  USER_CREATE: { name: 'create_user', labelAr: 'إضافة مستخدم' },
  USER_VIEW: { name: 'view_users', labelAr: 'عرض المستخدمين' },
  USER_UPDATE: { name: 'update_user', labelAr: 'تعديل بيانات المستخدم' },
  USER_DELETE: { name: 'delete_user', labelAr: 'حذف مستخدم' },

  // ─── Quotations (عروض الأسعار) ─────────────────────
  QUOTATION_CREATE: {
    name: 'system:create_quotation',
    labelAr: 'إنشاء عرض سعر',
  },
  QUOTATION_VIEW: {
    name: 'system:view_quotations',
    labelAr: 'عرض عروض الأسعار',
  },
  QUOTATION_UPDATE: {
    name: 'system:update_quotation',
    labelAr: 'تعديل عرض السعر',
  },
  QUOTATION_DELETE: {
    name: 'system:delete_quotation',
    labelAr: 'حذف عرض السعر',
  },
  QUOTATION_EXPORT_PDF: {
    name: 'system:export_quotation_pdf',
    labelAr: 'تصدير عرض السعر PDF',
  },
  QUOTATION_APPROVE: {
    name: 'system:approve_quotation',
    labelAr: 'الموافقة على عرض السعر',
  },

  // ─── Salaries (الرواتب) ────────────────────────────
  SALARY_CREATE: { name: 'create_salary', labelAr: 'إضافة راتب' },
  SALARY_VIEW: { name: 'view_salaries', labelAr: 'عرض الرواتب' },
  SALARY_MANAGE: { name: 'manage_salary', labelAr: 'إدارة الرواتب' },

  // ─── Payroll (مسير الرواتب) ──────────────────────── ✅ جديد
  PAYROLL_GENERATE: {
    name: 'generate_payroll',
    labelAr: 'إعداد مسير الرواتب',
  },
  PAYROLL_VIEW: {
    name: 'view_payroll',
    labelAr: 'عرض مسيرات الرواتب',
  },
  PAYROLL_EXPORT: {
    name: 'export_payroll',
    labelAr: 'تصدير مسير الرواتب',
  },
  PAYROLL_DELETE: {
    name: 'delete_payroll',
    labelAr: 'حذف مسير راتب',
  },

  // ─── Advances (السلف) ───────────────────────────────
  ADVANCE_REQUEST_SELF: {
    name: 'request_advance_self',
    labelAr: 'طلب سلفة ذاتية',
  },
  ADVANCE_CREATE_ADMIN: {
    name: 'create_advance_admin',
    labelAr: 'إنشاء سلفة (إداري)',
  },
  ADVANCE_VIEW: { name: 'view_advances', labelAr: 'عرض السلف' },
  ADVANCE_APPROVE: { name: 'approve_advance', labelAr: 'اعتماد السلف' },

  // ─── Attendance & Biometric Devices (الحضور والبصمة) ─
  BIOMETRIC_DEVICE_CREATE: {
    name: 'create_biometric_device',
    labelAr: 'إضافة جهاز بصمة',
  },
  BIOMETRIC_DEVICE_VIEW: {
    name: 'view_biometric_devices',
    labelAr: 'عرض أجهزة البصمة',
  },
  BIOMETRIC_DEVICE_UPDATE: {
    name: 'update_biometric_device',
    labelAr: 'تعديل جهاز بصمة',
  },
  BIOMETRIC_DEVICE_DELETE: {
    name: 'delete_biometric_device',
    labelAr: 'حذف جهاز بصمة',
  },
  BIOMETRIC_DEVICE_SYNC: {
    name: 'sync_biometric_device',
    labelAr: 'مزامنة جهاز البصمة',
  },
  ATTENDANCE_LOGS_VIEW: {
    name: 'view_attendance_logs',
    labelAr: 'عرض سجلات الحضور',
  },
  ATTENDANCE_SUMMARY_VIEW: {
    name: 'view_attendance_summary',
    labelAr: 'عرض ملخص الحضور اليومي',
  },
  ATTENDANCE_REPORTS_VIEW: {
    name: 'view_attendance_reports',
    labelAr: 'عرض تقارير الحضور الشهرية',
  },

  // ─── Contracts (العقود) ─────────────────────────────
  CONTRACT_CREATE: { name: 'create_contract', labelAr: 'إنشاء عقد' },
  CONTRACT_VIEW: { name: 'view_contracts', labelAr: 'عرض العقود' },
  CONTRACT_UPDATE: { name: 'update_contract', labelAr: 'تعديل عقد' },
  CONTRACT_DELETE: { name: 'delete_contract', labelAr: 'حذف عقد' },
  CONTRACT_EXPORT: { name: 'export_contracts', labelAr: 'تصدير تقرير العقود' },

  // ─── Employees (الموظفين) ───────────────────────────
  EMPLOYEE_CREATE: { name: 'create_employee', labelAr: 'إضافة موظف' },
  EMPLOYEE_VIEW: { name: 'view_employees', labelAr: 'عرض الموظفين' },
  EMPLOYEE_UPDATE: { name: 'update_employee', labelAr: 'تعديل بيانات الموظف' },
  EMPLOYEE_DELETE: { name: 'delete_employee', labelAr: 'حذف موظف' },
  EMPLOYEE_ONBOARD: {
    name: 'onboard_employee',
    labelAr: 'تشغيل موظف جديد (Onboarding)',
  },
  EMPLOYEE_EXPORT: {
    name: 'export_employees',
    labelAr: 'تصدير تقرير الموظفين',
  },

  // ─── Leaves (الإجازات) ──────────────────────────────
  LEAVE_REQUEST_SELF: {
    name: 'request_leave_self',
    labelAr: 'طلب إجازة ذاتية',
  },
  LEAVE_CREATE_ADMIN: {
    name: 'create_leave_admin',
    labelAr: 'إنشاء إجازة (إداري)',
  },
  LEAVE_VIEW: { name: 'view_leaves', labelAr: 'عرض الإجازات' },
  LEAVE_APPROVE: { name: 'approve_leave', labelAr: 'اعتماد الإجازات' },
  LEAVE_BALANCE_MANAGE: {
    name: 'manage_leave_balance',
    labelAr: 'إدارة رصيد الإجازات',
  },

  // ─── Loans (القروض) ─────────────────────────────────
  LOAN_REQUEST_SELF: { name: 'request_loan_self', labelAr: 'طلب قرض ذاتي' },
  LOAN_VIEW: { name: 'view_loans', labelAr: 'عرض القروض' },
  LOAN_APPROVE: { name: 'approve_loan', labelAr: 'اعتماد القروض' },

  // ─── Permissions Management (إدارة الصلاحيات) ───────
  PERMISSION_CREATE: {
    name: 'create_permission',
    labelAr: 'إنشاء صلاحية جديدة',
  },
  PERMISSION_VIEW: { name: 'view_permissions', labelAr: 'عرض قائمة الصلاحيات' },
  PERMISSION_UPDATE: { name: 'update_permission', labelAr: 'تعديل صلاحية' },
  PERMISSION_DELETE: { name: 'delete_permission', labelAr: 'حذف صلاحية' },

  // ── Roles Management (إدارة الأدوار) ───────────────
  ROLE_CREATE: { name: 'create_role', labelAr: 'إنشاء دور جديد' },
  ROLE_VIEW: { name: 'view_roles', labelAr: 'عرض الأدوار' },
  ROLE_UPDATE: { name: 'update_role', labelAr: 'تعديل دور' },
  ROLE_DELETE: { name: 'delete_role', labelAr: 'حذف دور' },

  // ✅ Shifts (الورديات)
  SHIFT_CREATE: {
    name: 'create_shift',
    labelAr: 'إنشاء وردية',
  },
  SHIFT_VIEW: {
    name: 'view_shifts',
    labelAr: 'عرض الورديات',
  },
  SHIFT_UPDATE: {
    name: 'update_shift',
    labelAr: 'تعديل وردية',
  },

  // ___________________________________________________
  SETTLEMENT_VIEW: {
    name: 'view_settlements',
    labelAr: 'عرض مستحقات بدل الاجازة',
  },
  SETTLEMENT_CREATE: {
    name: 'create_settlements',
    labelAr: 'انشاء مستحقات بدل الاجازة',
  },

  // ─── System (system admins only) ─────────────────────
  SYSTEM_STATS: {
    name: 'system:view_platform_stats',
    labelAr: 'عرض إحصائيات النظام',
  },
};
