// src/modules/pos/pos.constants.ts

/**
 * حد العمل بلا اتصال: كم تبقى شاشة الكاشير تبيع دون أن تصل للسيرفر.
 *
 * البيع لا يتوقف بسبب انقطاع الإنترنت — لكن شاشة لا تتصل أبداً لا تعرف أن
 * الاشتراك انتهى أو أن الجهاز أُوقف. لذلك: تنبيه بعد مدة، ثم منع فتح وردية
 * جديدة (الوردية المفتوحة تكمل وتُقفَّل، وما بيع يبقى محفوظاً ويُرفع لاحقاً).
 *
 * تنزل هذه القيم للشاشة مع كل مزامنة، فتغييرها هنا يصل الأجهزة دون تحديثها.
 */
export const POS_OFFLINE_POLICY = {
  /** ساعات بلا اتصال قبل ظهور التنبيه (3 أيام) */
  warnAfterHours: 72,
  /** ساعات بلا اتصال قبل منع فتح وردية جديدة (7 أيام) */
  blockAfterHours: 168,
} as const;

/** ترويسات هوية الجهاز في مسارات ‎/pos/device */
export const POS_DEVICE_HEADER = 'x-pos-device';
export const POS_KEY_HEADER = 'x-pos-key';
export const POS_INSTALLATION_HEADER = 'x-pos-installation';

/** اشتراك الشركة غير سارٍ: الشاشة تتوقف عن فتح ورديات حتى يُجدَّد */
export const HTTP_SUBSCRIPTION_INACTIVE = 402;
