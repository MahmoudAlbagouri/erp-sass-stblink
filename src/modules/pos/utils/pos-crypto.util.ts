// src/modules/pos/utils/pos-crypto.util.ts
// مفتاح الجهاز والأرقام السرية للكاشيرات.
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';

// ─── مفتاح الجهاز ───────────────────────────────────────────────────────────
// مفتاح عشوائي طويل (256 بت): لا يُخمَّن، فتكفي بصمة SHA-256 سريعة لحفظه.

export function generateDeviceKey(): string {
  return randomBytes(32).toString('base64url');
}

export function hashDeviceKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** مقارنة بزمن ثابت: لا يتسرب من زمن الرد كم محرفاً طابق */
export function deviceKeyMatches(key: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashDeviceKey(key), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return (
    candidate.length === stored.length && timingSafeEqual(candidate, stored)
  );
}

// ─── الرقم السري للكاشير ─────────────────────────────────────────────────────
// يُتحقق منه على الجهاز بلا إنترنت، فمشتقّه ينزل للأجهزة. رقم من 4–6 خانات
// قليل الاحتمالات مهما كان الاشتقاق؛ PBKDF2 يجعل تجربة الاحتمالات على جهاز
// مسروق مكلفة، لا مستحيلة. الرقم يفتح وردية على شاشة مربوطة فقط — لا يُستخدم
// للدخول إلى أي شيء آخر.

/** نفس القيمة تستخدمها الشاشة مع WebCrypto (انظر app/pos/cashiers.ts) */
export const PIN_ITERATIONS = 100_000;
const PIN_KEY_BYTES = 32;

export interface PinSecret {
  pinSalt: string;
  pinHash: string;
  pinIterations: number;
}

export function derivePin(
  pin: string,
  salt: string,
  iterations: number,
): string {
  return pbkdf2Sync(
    pin,
    Buffer.from(salt, 'base64'),
    iterations,
    PIN_KEY_BYTES,
    'sha256',
  ).toString('base64');
}

export function hashPin(pin: string): PinSecret {
  const pinSalt = randomBytes(16).toString('base64');
  return {
    pinSalt,
    pinHash: derivePin(pin, pinSalt, PIN_ITERATIONS),
    pinIterations: PIN_ITERATIONS,
  };
}
