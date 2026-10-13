// src/common/constants/countries.ts
// المصدر الوحيد للدول المدعومة: من الدولة تُشتق عملة الشركة، مفتاح الهاتف،
// المنطقة الزمنية ونسبة الضريبة الافتراضية.
//
// ⚠️ الواجهة تحمل نسخة مطابقة (app/utils/countries.ts): أي تعديل هنا يُكرَّر هناك.

export interface CountryConfig {
  /** ISO 3166-1 alpha-2 */
  code: string;
  nameAr: string;
  nameEn: string;
  /** مفتاح الاتصال الدولي بدون + */
  dialCode: string;
  /** ISO 4217 */
  currency: string;
  /** رمز العملة كما يُعرض بجانب المبالغ */
  currencySymbol: string;
  currencyNameAr: string;
  /** خانات العملة العشرية (ISO 4217): 3 للدينار والريال العُماني، 2 للبقية */
  currencyDecimals: number;
  /** IANA */
  timezone: string;
  /** نسبة ضريبة القيمة المضافة الأساسية % (0 = لا ضريبة قيمة مضافة) */
  vatRate: number;
  /** أقل وأكثر عدد خانات للرقم المحلي (بدون مفتاح الدولة والصفر البادئ) */
  phoneLength: readonly [min: number, max: number];
}

export const COUNTRIES: readonly CountryConfig[] = [
  {
    code: 'SA',
    nameAr: 'السعودية',
    nameEn: 'Saudi Arabia',
    dialCode: '966',
    currency: 'SAR',
    currencySymbol: 'ر.س',
    currencyNameAr: 'ريال سعودي',
    currencyDecimals: 2,
    timezone: 'Asia/Riyadh',
    vatRate: 15,
    phoneLength: [9, 9],
  },
  {
    code: 'EG',
    nameAr: 'مصر',
    nameEn: 'Egypt',
    dialCode: '20',
    currency: 'EGP',
    currencySymbol: 'ج.م',
    currencyNameAr: 'جنيه مصري',
    currencyDecimals: 2,
    timezone: 'Africa/Cairo',
    vatRate: 14,
    phoneLength: [8, 10],
  },
  {
    code: 'AE',
    nameAr: 'الإمارات',
    nameEn: 'United Arab Emirates',
    dialCode: '971',
    currency: 'AED',
    currencySymbol: 'د.إ',
    currencyNameAr: 'درهم إماراتي',
    currencyDecimals: 2,
    timezone: 'Asia/Dubai',
    vatRate: 5,
    phoneLength: [8, 9],
  },
  {
    code: 'KW',
    nameAr: 'الكويت',
    nameEn: 'Kuwait',
    dialCode: '965',
    currency: 'KWD',
    currencySymbol: 'د.ك',
    currencyNameAr: 'دينار كويتي',
    currencyDecimals: 3,
    timezone: 'Asia/Kuwait',
    vatRate: 0,
    phoneLength: [8, 8],
  },
  {
    code: 'QA',
    nameAr: 'قطر',
    nameEn: 'Qatar',
    dialCode: '974',
    currency: 'QAR',
    currencySymbol: 'ر.ق',
    currencyNameAr: 'ريال قطري',
    currencyDecimals: 2,
    timezone: 'Asia/Qatar',
    vatRate: 0,
    phoneLength: [8, 8],
  },
  {
    code: 'BH',
    nameAr: 'البحرين',
    nameEn: 'Bahrain',
    dialCode: '973',
    currency: 'BHD',
    currencySymbol: 'د.ب',
    currencyNameAr: 'دينار بحريني',
    currencyDecimals: 3,
    timezone: 'Asia/Bahrain',
    vatRate: 10,
    phoneLength: [8, 8],
  },
  {
    code: 'OM',
    nameAr: 'عُمان',
    nameEn: 'Oman',
    dialCode: '968',
    currency: 'OMR',
    currencySymbol: 'ر.ع',
    currencyNameAr: 'ريال عُماني',
    currencyDecimals: 3,
    timezone: 'Asia/Muscat',
    vatRate: 5,
    phoneLength: [8, 8],
  },
  {
    code: 'JO',
    nameAr: 'الأردن',
    nameEn: 'Jordan',
    dialCode: '962',
    currency: 'JOD',
    currencySymbol: 'د.أ',
    currencyNameAr: 'دينار أردني',
    currencyDecimals: 3,
    timezone: 'Asia/Amman',
    vatRate: 16,
    phoneLength: [8, 9],
  },
  {
    code: 'IQ',
    nameAr: 'العراق',
    nameEn: 'Iraq',
    dialCode: '964',
    currency: 'IQD',
    currencySymbol: 'د.ع',
    currencyNameAr: 'دينار عراقي',
    currencyDecimals: 3,
    timezone: 'Asia/Baghdad',
    vatRate: 0,
    phoneLength: [8, 10],
  },
  {
    code: 'LB',
    nameAr: 'لبنان',
    nameEn: 'Lebanon',
    dialCode: '961',
    currency: 'LBP',
    currencySymbol: 'ل.ل',
    currencyNameAr: 'ليرة لبنانية',
    currencyDecimals: 2,
    timezone: 'Asia/Beirut',
    vatRate: 11,
    phoneLength: [7, 8],
  },
  {
    code: 'SY',
    nameAr: 'سوريا',
    nameEn: 'Syria',
    dialCode: '963',
    currency: 'SYP',
    currencySymbol: 'ل.س',
    currencyNameAr: 'ليرة سورية',
    currencyDecimals: 2,
    timezone: 'Asia/Damascus',
    vatRate: 0,
    phoneLength: [8, 9],
  },
  {
    code: 'YE',
    nameAr: 'اليمن',
    nameEn: 'Yemen',
    dialCode: '967',
    currency: 'YER',
    currencySymbol: 'ر.ي',
    currencyNameAr: 'ريال يمني',
    currencyDecimals: 2,
    timezone: 'Asia/Aden',
    vatRate: 5,
    phoneLength: [7, 9],
  },
  {
    code: 'PS',
    nameAr: 'فلسطين',
    nameEn: 'Palestine',
    dialCode: '970',
    currency: 'ILS',
    currencySymbol: '₪',
    currencyNameAr: 'شيكل',
    currencyDecimals: 2,
    timezone: 'Asia/Hebron',
    vatRate: 16,
    phoneLength: [8, 9],
  },
  {
    code: 'LY',
    nameAr: 'ليبيا',
    nameEn: 'Libya',
    dialCode: '218',
    currency: 'LYD',
    currencySymbol: 'د.ل',
    currencyNameAr: 'دينار ليبي',
    currencyDecimals: 3,
    timezone: 'Africa/Tripoli',
    vatRate: 0,
    phoneLength: [8, 9],
  },
  {
    code: 'TN',
    nameAr: 'تونس',
    nameEn: 'Tunisia',
    dialCode: '216',
    currency: 'TND',
    currencySymbol: 'د.ت',
    currencyNameAr: 'دينار تونسي',
    currencyDecimals: 3,
    timezone: 'Africa/Tunis',
    vatRate: 19,
    phoneLength: [8, 8],
  },
  {
    code: 'DZ',
    nameAr: 'الجزائر',
    nameEn: 'Algeria',
    dialCode: '213',
    currency: 'DZD',
    currencySymbol: 'د.ج',
    currencyNameAr: 'دينار جزائري',
    currencyDecimals: 2,
    timezone: 'Africa/Algiers',
    vatRate: 19,
    phoneLength: [8, 9],
  },
  {
    code: 'MA',
    nameAr: 'المغرب',
    nameEn: 'Morocco',
    dialCode: '212',
    currency: 'MAD',
    currencySymbol: 'د.م',
    currencyNameAr: 'درهم مغربي',
    currencyDecimals: 2,
    timezone: 'Africa/Casablanca',
    vatRate: 20,
    phoneLength: [9, 9],
  },
  {
    code: 'SD',
    nameAr: 'السودان',
    nameEn: 'Sudan',
    dialCode: '249',
    currency: 'SDG',
    currencySymbol: 'ج.س',
    currencyNameAr: 'جنيه سوداني',
    currencyDecimals: 2,
    timezone: 'Africa/Khartoum',
    vatRate: 17,
    phoneLength: [9, 9],
  },
];

/** دولة الشركات المُنشأة قبل دعم تعدد الدول، وأي قيمة غير معروفة */
export const DEFAULT_COUNTRY_CODE = 'SA';

export const COUNTRY_CODES: readonly string[] = COUNTRIES.map((c) => c.code);

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));
const BY_CURRENCY = new Map(COUNTRIES.map((c) => [c.currency, c]));

export function findCountry(code?: string | null): CountryConfig | undefined {
  return code ? BY_CODE.get(code.toUpperCase()) : undefined;
}

/** الدولة المطابقة للرمز، أو الافتراضية إذا غاب الرمز أو لم يُعرف */
export function getCountry(code?: string | null): CountryConfig {
  return findCountry(code) ?? BY_CODE.get(DEFAULT_COUNTRY_CODE)!;
}

function byCurrency(currency?: string | null): CountryConfig {
  const match = currency ? BY_CURRENCY.get(currency.toUpperCase()) : undefined;
  return match ?? getCountry();
}

/** رمز العرض لعملة (ISO 4217): "ر.س" لـ SAR */
export function getCurrencySymbol(currency?: string | null): string {
  return byCurrency(currency).currencySymbol;
}

/** عدد الخانات العشرية لعملة (ISO 4217): 3 لـ KWD، 2 لـ SAR */
export function getCurrencyDecimals(currency?: string | null): number {
  return byCurrency(currency).currencyDecimals;
}
