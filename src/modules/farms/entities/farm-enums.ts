// src/modules/farms/entities/farm-enums.ts
// قوائم ثابتة مشتركة بين كيانات المزارع. ثابتة لأن تحليلها لاحقاً (الإنتاجية،
// الآفات، التكلفة) يحتاج أن يفرّق بينها — النص الحر لا يُجمَّع.

/** العملية الزراعية */
export enum FarmOperationType {
  IRRIGATION = 'irrigation',
  FERTILIZATION = 'fertilization',
  /** رش مبيد أو مكافحة */
  SPRAYING = 'spraying',
  /** تلقيح النخيل */
  POLLINATION = 'pollination',
  /** تقليم */
  PRUNING = 'pruning',
  /** تكريب: إزالة الكرب والسعف اليابس */
  FROND_REMOVAL = 'frond_removal',
  /** خف الثمار أو الشماريخ */
  THINNING = 'thinning',
  /** تكميم / تغطية العذوق */
  BAGGING = 'bagging',
  /** تدلية / تحدير العذوق */
  BUNCH_TYING = 'bunch_tying',
  /** فصل الفسائل */
  OFFSHOOT_REMOVAL = 'offshoot_removal',
  WEEDING = 'weeding',
  /** حرث وتجهيز أرض */
  TILLAGE = 'tillage',
  /** بذر / زراعة */
  SOWING = 'sowing',
  /** شتل / نقل */
  TRANSPLANTING = 'transplanting',
  /** حش (أعلاف) */
  MOWING = 'mowing',
  /** تحليل تربة أو مياه */
  SOIL_TEST = 'soil_test',
  CLEANING = 'cleaning',
  /** صيانة شبكة الري أو الصوبة */
  MAINTENANCE = 'maintenance',
  OTHER = 'other',
}

/** كيف تُتابع زراعة: نخلة نخلة، بالعدد، أو بالمساحة */
export enum PlantingTrackingMode {
  INDIVIDUAL = 'individual',
  COUNT = 'count',
  AREA = 'area',
}

/** دقة تاريخ الزرع: نخيل قديم يُعرف عامه فقط */
export enum DatePrecision {
  DAY = 'day',
  MONTH = 'month',
  YEAR = 'year',
  ESTIMATED = 'estimated',
}
