// src/config/jwt.config.ts

/**
 * المصدر الوحيد لمفاتيح الـ JWT — يُستخدم في التوقيع (AuthService)
 * والتحقق (Strategies) معاً حتى لا يختلف المفتاح بين الطرفين.
 *
 * تُقرأ القيم عند الطلب (وليس عند تحميل الملف) لأن ConfigModule
 * يحمّل ملف .env بعد استيراد الموديولات.
 */
function resolveSecret(envKey: string, devFallback: string): string {
  const value = process.env[envKey];
  if (value) return value;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envKey} is required in production`);
  }
  return devFallback;
}

export const getJwtAccessSecret = (): string =>
  resolveSecret('JWT_ACCESS_SECRET', 'dev-only-access-secret');

export const getJwtRefreshSecret = (): string =>
  resolveSecret('JWT_REFRESH_SECRET', 'dev-only-refresh-secret');

export const JWT_ACCESS_EXPIRES_IN = '15m';
