// src/modules/attendance/utils/template-cipher.ts
// قوالب البصمات بيانات حيوية: لا تُخزَّن نصاً مقروءاً. AES-256-GCM يضمن السرية
// وأن القالب لم يُعبث به (التعديل يُفشل فك التشفير).
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { getJwtAccessSecret } from '../../../config/jwt.config';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * المفتاح: BIOMETRIC_SECRET إن وُجد، وإلا يُشتق من مفتاح الـ JWT بفصل مجال.
 * تغيير أيٍّ منهما يُبطل القوالب المحفوظة (تُعاد من الأجهزة عند التسجيل التالي).
 */
function key(): Buffer {
  const secret =
    process.env.BIOMETRIC_SECRET ||
    `biometric-templates:${getJwtAccessSecret()}`;
  return createHash('sha256').update(secret).digest();
}

export function encryptTemplate(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const packed = Buffer.concat([iv, cipher.getAuthTag(), body]);
  return `${VERSION}:${packed.toString('base64')}`;
}

/** null لقالب لا يُفك (مفتاح تغيّر أو بيانات تالفة) */
export function decryptTemplate(stored: string): string | null {
  const [version, payload] = stored.split(':', 2);
  if (version !== VERSION || !payload) return null;
  try {
    const packed = Buffer.from(payload, 'base64');
    const iv = packed.subarray(0, IV_BYTES);
    const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(packed.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
