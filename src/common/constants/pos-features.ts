// src/common/constants/pos-features.ts
//
// مميزات شاشة الكاشير التي تُشغَّل وتُقفل لكل شركة: محل لا يحتاج ميزة لا يرى
// زرها ولا اختصارها. المصدر الوحيد للقائمة والقوالب الجاهزة — صفحة الإعدادات
// في لوحة التحكم تقرأها من GET /pos/screen-settings ولا تكررها.
//
// ثلاثة مستويات: الباقة (ما يُباع: التوصيل، المطاعم) ← مميزات الشركة (هنا: ما
// يظهر على الشاشة) ← صلاحيات كل كاشير (المرتجع، تغيير السعر، حد الخصم).

export const POS_FEATURE_KEYS = [
  'customers',
  'addCustomer',
  'creditSales',
  'lineDiscount',
  'invoiceDiscount',
  'priceChange',
  'units',
  'holdSales',
  'cardPayments',
  'quickPay',
  'autoPrint',
  'cashMoves',
  'manualDrawer',
  'returns',
  'scaleBarcode',
  'showStock',
  'numpad',
  'customerDisplay',
  'delivery',
  'tables',
  'kitchen',
] as const;

export type PosFeatureKey = (typeof POS_FEATURE_KEYS)[number];
export type PosFeatures = Record<PosFeatureKey, boolean>;

/** ميزة الباقة التي تحتاجها الميزة (بدونها تظهر مقفلة "ليست في باقتك") */
export const POS_FEATURE_PLAN: Partial<Record<PosFeatureKey, string>> = {
  delivery: 'delivery_module',
  tables: 'restaurant_module',
  kitchen: 'restaurant_module',
};

/** ميزة لا معنى لها بدون أخرى (البيع الآجل لعميل مسجّل) */
export const POS_FEATURE_REQUIRES: Partial<
  Record<PosFeatureKey, PosFeatureKey>
> = {
  addCustomer: 'customers',
  creditSales: 'customers',
};

export interface PosFeatureDefinition {
  key: PosFeatureKey;
  label: string;
  description: string;
}

export interface PosFeatureGroup {
  title: string;
  features: PosFeatureDefinition[];
}

export const POS_FEATURE_GROUPS: PosFeatureGroup[] = [
  {
    title: 'البيع والعملاء',
    features: [
      {
        key: 'customers',
        label: 'اختيار عميل في الفاتورة',
        description:
          'قائمة العملاء أعلى السلة. بدونها كل البيع لـ"عميل نقدي" (أسرع للبقالة والكافيه).',
      },
      {
        key: 'addCustomer',
        label: 'إضافة عميل جديد من الشاشة',
        description: 'زر بجانب قائمة العملاء: اسم وجوال ورقم ضريبي.',
      },
      {
        key: 'creditSales',
        label: 'البيع الآجل (على حساب العميل)',
        description:
          'الباقي على حساب عميل مسجّل بحد ائتمانه. إقفالها يمنعه على الشاشة والسيرفر معاً.',
      },
      {
        key: 'units',
        label: 'البيع بأكثر من وحدة',
        description: 'اختيار الوحدة على السطر (قطعة، علبة، كرتونة).',
      },
      {
        key: 'holdSales',
        label: 'تعليق الفاتورة',
        description:
          'العميل ذهب ليحضر شيئاً: تُعلَّق فاتورته ويخدم الكاشير غيره (F6 / F7).',
      },
      {
        key: 'returns',
        label: 'المرتجع من الشاشة',
        description:
          'إرجاع أصناف من فاتورة برقمها وردّ المبلغ (ولكل كاشير صلاحيته).',
      },
    ],
  },
  {
    title: 'الأسعار والخصم',
    features: [
      {
        key: 'lineDiscount',
        label: 'خصم على الصنف',
        description: 'حقل خصم تحت كل سطر في السلة (/).',
      },
      {
        key: 'invoiceDiscount',
        label: 'خصم على الفاتورة',
        description: 'نسبة أو مبلغ على الفاتورة كلها (F8).',
      },
      {
        key: 'priceChange',
        label: 'تغيير سعر صنف في فاتورة',
        description:
          'سعر هذه الفاتورة وحدها (=). الصنف بسعر مفتوح يُكتب سعره دائماً.',
      },
    ],
  },
  {
    title: 'الدفع والطباعة',
    features: [
      {
        key: 'cardPayments',
        label: 'الدفع بالشبكة / البطاقة',
        description: 'بدونها الدفع نقداً فقط.',
      },
      {
        key: 'quickPay',
        label: 'دفع سريع للعميل النقدي',
        description:
          'زر الدفع يتم البيع نقداً بالمبلغ بالضبط ويطبع فوراً بلا شاشة دفع. العميل المسجّل والشبكة من "دفع آخر".',
      },
      {
        key: 'autoPrint',
        label: 'طباعة الإيصال تلقائياً',
        description: 'بعد كل بيع. بدونها يُطبع بزر "طباعة" فقط (توفير الورق).',
      },
    ],
  },
  {
    title: 'الدرج',
    features: [
      {
        key: 'cashMoves',
        label: 'إيداع وسحب نقدي',
        description: 'مصروف نثري أو فكّة من الدرج بسبب (F9).',
      },
      {
        key: 'manualDrawer',
        label: 'فتح الدرج بلا بيع',
        description: 'زر يفتح الدرج ويُسجَّل على الوردية.',
      },
    ],
  },
  {
    title: 'الشاشة والأجهزة',
    features: [
      {
        key: 'scaleBarcode',
        label: 'باركود الميزان',
        description:
          'أصناف موزونة بباركود يحمل الوزن أو السعر (تفاصيله في إعدادات الفوترة).',
      },
      {
        key: 'showStock',
        label: 'إظهار الرصيد على الصنف',
        description: 'المتاح في مخزن الجهاز على كل صنف.',
      },
      {
        key: 'numpad',
        label: 'لوحة الأرقام العائمة',
        description: 'لشاشات اللمس: تُسحب لأي مكان (F3).',
      },
      {
        key: 'customerDisplay',
        label: 'شاشة العميل',
        description: 'نافذة على الشاشة الثانية تعرض السلة والإجمالي للعميل.',
      },
    ],
  },
  {
    title: 'التوصيل والمطاعم',
    features: [
      {
        key: 'delivery',
        label: 'البيع توصيل',
        description: 'زر توصيل بطيار أو شركة شحن، والتحصيل عند الاستلام (F10).',
      },
      {
        key: 'tables',
        label: 'الطاولات',
        description: 'طلبات الصالة على طاولاتها حتى الدفع.',
      },
      {
        key: 'kitchen',
        label: 'المطبخ',
        description:
          'الإرسال للمطبخ بالإضافات والإلغاءات، البون المطبوع، وشاشة المطبخ.',
      },
    ],
  },
];

/** كل المميزات مفعّلة: ما كانت عليه الشاشة قبل الإعداد (الشركات القائمة) */
const all = (overrides: Partial<PosFeatures> = {}): PosFeatures => ({
  ...(Object.fromEntries(
    POS_FEATURE_KEYS.map((key) => [key, true]),
  ) as PosFeatures),
  ...overrides,
});

export const DEFAULT_POS_FEATURES: PosFeatures = all({ quickPay: false });

export const POS_TEMPLATE_KEYS = [
  'all',
  'supermarket',
  'restaurant',
  'retail',
  'pharmacy',
] as const;
export type PosTemplateKey = (typeof POS_TEMPLATE_KEYS)[number];

export interface PosTemplate {
  key: PosTemplateKey;
  label: string;
  description: string;
  features: PosFeatures;
}

/** قوالب جاهزة: نقطة بداية لنوع النشاط، وأي ميزة تُعدَّل بعدها */
export const POS_TEMPLATES: PosTemplate[] = [
  {
    key: 'all',
    label: 'كل المميزات',
    description: 'الشاشة كاملة كما هي — لنشاط يحتاج كل شيء.',
    features: DEFAULT_POS_FEATURES,
  },
  {
    key: 'supermarket',
    label: 'سوبر ماركت / بقالة',
    description:
      'سرعة عند الزحمة: دفع سريع، باركود الميزان، والكرتونة والقطعة.',
    features: all({ priceChange: false, tables: false, kitchen: false }),
  },
  {
    key: 'restaurant',
    label: 'مطعم / كافيه',
    description: 'الطاولات والمطبخ ودفع سريع، بلا ميزان ولا وحدات ولا آجل.',
    features: all({
      creditSales: false,
      lineDiscount: false,
      priceChange: false,
      units: false,
      scaleBarcode: false,
      showStock: false,
      customerDisplay: false,
    }),
  },
  {
    key: 'retail',
    label: 'محل ملابس / إكسسوارات',
    description: 'تفاوض على السعر وخصومات وآجل، بلا ميزان ولا مطبخ.',
    features: all({
      units: false,
      scaleBarcode: false,
      numpad: false,
      delivery: false,
      tables: false,
      kitchen: false,
      quickPay: false,
    }),
  },
  {
    key: 'pharmacy',
    label: 'صيدلية',
    description: 'العلبة والشريط، وآجل للعملاء، بلا تغيير سعر ولا ميزان.',
    features: all({
      priceChange: false,
      scaleBarcode: false,
      customerDisplay: false,
      tables: false,
      kitchen: false,
      quickPay: false,
    }),
  },
];

/** القالب الذي تطابقه المميزات تماماً، أو "custom" */
export function matchingTemplate(
  features: PosFeatures,
): PosTemplateKey | 'custom' {
  const found = POS_TEMPLATES.find((template) =>
    POS_FEATURE_KEYS.every((key) => template.features[key] === features[key]),
  );
  return found?.key ?? 'custom';
}
