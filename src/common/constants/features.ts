// src/common/constants/features.ts
import { FeatureMetadata } from '../decorators/requires-feature.decorator';

export const FEATURES = {
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
    labelAr: 'موديول تسوية مستحقات الموظفين',
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
  BONUSES_MODULE: {
    name: 'bonuses_module',
    labelAr: 'موديول المكافآت والحوافز',
  },
  DEDUCTIONS_MODULE: {
    name: 'deductions_module',
    labelAr: 'موديول الخصومات',
  },
  QUOTATIONS_MODULE: {
    name: 'quotations_module',
    labelAr: 'موديول عروض الأسعار',
  },
  RESIGNATIONS_MODULE: {
    name: 'resignations_module',
    labelAr: 'موديول الاستقالات',
  },

  // ─── الموديولات التجارية ─────────────────────────────
  PRODUCTS_MODULE: {
    name: 'products_module',
    labelAr: 'موديول الأصناف',
  },
  INVENTORY_MODULE: {
    name: 'inventory_module',
    labelAr: 'موديول المخزون والمخازن',
  },
  PURCHASING_MODULE: {
    name: 'purchasing_module',
    labelAr: 'موديول المشتريات والموردين',
  },
  SALES_MODULE: {
    name: 'sales_module',
    labelAr: 'موديول المبيعات والعملاء',
  },
  POS_MODULE: {
    name: 'pos_module',
    labelAr: 'نقاط البيع (الكاشير) أونلاين وأوفلاين',
  },
  DELIVERY_MODULE: {
    name: 'delivery_module',
    labelAr: 'التوصيل والشحن (طيارين وشركات شحن وتسوياتهم)',
  },
  RESTAURANT_MODULE: {
    name: 'restaurant_module',
    labelAr: 'المطاعم: الطاولات وشاشة المطبخ وبون المطبخ',
  },
  ACCOUNTING_MODULE: {
    name: 'accounting_module',
    labelAr: 'المحاسبة (شجرة الحسابات والقيود والقوائم المالية)',
  },

  // ─── ميزات إضافية (Add-ons) ──────────────────────────
  REPORTS_EXPORT: {
    name: 'reports_export',
    labelAr: 'تصدير التقارير (Excel / PDF)',
  },
  BIOMETRIC_INTEGRATION: {
    name: 'biometric_integration',
    labelAr: 'ربط أجهزة البصمة (ZKTeco وHikvision وغيرها)',
  },
  MULTI_BRANCH: {
    name: 'multi_branch',
    labelAr: 'دعم الفروع المتعددة',
  },
  API_ACCESS: {
    name: 'api_access',
    labelAr: 'الوصول عبر API خارجي',
  },
} as const satisfies Record<string, FeatureMetadata>;
