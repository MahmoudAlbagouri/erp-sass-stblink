// src/common/constants/features.ts
import { FeatureMetadata } from '../decorators/requires-feature.decorator';

export const FEATURES: Record<string, FeatureMetadata> = {
  // ─── الموديولات الأساسية ─────────────────────────────
  EMPLOYEES_MODULE: {
    name: 'employees_module',
    labelAr: 'موديول الموظفين',
  },
  PAYROLL_MODULE: {
    name: 'payroll_module',
    labelAr: 'موديول مسير الرواتب',
  },
  ATTENDANCE_MODULE: {
    name: 'attendance_module',
    labelAr: 'موديول الحضور والانصراف',
  },
  LEAVES_MODULE: {
    name: 'leaves_module',
    labelAr: 'موديول الإجازات',
  },
  SETTLEMENTS_MODULE: {
    name: 'settlements_module',
    labelAr: 'موديول تسوية مستحقات نهاية الخدمة',
  },
  ADVANCES_MODULE: {
    name: 'advances_module',
    labelAr: 'موديول السلف',
  },
  LOANS_MODULE: {
    name: 'loans_module',
    labelAr: 'موديول القروض',
  },
  CONTRACTS_MODULE: {
    name: 'contracts_module',
    labelAr: 'موديول العقود',
  },
  QUOTATIONS_MODULE: {
    name: 'quotations_module',
    labelAr: 'موديول عروض الأسعار',
  },

  // ─── ميزات إضافية (Add-ons) ──────────────────────────
  REPORTS_EXPORT: {
    name: 'reports_export',
    labelAr: 'تصدير التقارير (Excel / PDF)',
  },
  BIOMETRIC_INTEGRATION: {
    name: 'biometric_integration',
    labelAr: 'ربط أجهزة البصمة (ZKTeco)',
  },
  MULTI_BRANCH: {
    name: 'multi_branch',
    labelAr: 'دعم الفروع المتعددة',
  },
  API_ACCESS: {
    name: 'api_access',
    labelAr: 'الوصول عبر API خارجي',
  },
};
