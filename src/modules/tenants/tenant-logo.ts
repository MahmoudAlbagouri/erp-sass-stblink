// src/modules/tenants/tenant-logo.ts
// شعار الشركة: يُحفظ صورةً صغيرة (Data URL) في tenants.logo_url لا ملفاً على
// القرص — فتطبعه شاشة الكاشير بلا إنترنت، وتقرؤه تقارير PDF مباشرة، ولا تبقى
// ملفات يتيمة عند تغييره. الواجهة تصغّره قبل الرفع (أطول ضلع 480px).

/** أقصى طول للـ Data URL (~220KB صورة) */
export const MAX_LOGO_LENGTH = 300_000;

/** صورة PNG أو JPEG أو WebP مرمّزة Base64 */
export const LOGO_PATTERN =
  /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** مسار الرفع: له حد حجم أكبر من بقية الطلبات (انظر main.ts) */
export const LOGO_ROUTE = '/tenants/me/logo';

/** ما تحتاجه الطباعة والتقارير من هوية الشركة */
export interface TenantBranding {
  companyName: string;
  /** Data URL للشعار، أو null إن لم يُرفع */
  logo: string | null;
}
