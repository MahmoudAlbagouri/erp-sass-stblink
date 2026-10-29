// src/modules/files/file-url.signer.ts
import { Injectable } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { getJwtAccessSecret } from '../../config/jwt.config';

/** صلاحية الرابط: ساعة على الأقل */
const TTL_SECONDS = 60 * 60;
/**
 * تُقرَّب نهاية الصلاحية لربع ساعة: الرابط نفسه يتكرر في الطلبات المتقاربة
 * فيبقى الملف في ذاكرة المتصفح بدل تنزيله في كل مرة.
 */
const BUCKET_SECONDS = 15 * 60;

/**
 * روابط ملفات موقَّعة مؤقتة (مثل S3 presigned URLs):
 * /files/<id>/<الاسم>?exp=<ثوانٍ>&sig=<HMAC(id.exp)>
 *
 * الرابط نفسه هو الإذن — يعمل في <img> و"فتح في تبويب" والتحميل بلا توكن —
 * ولا يصدر إلا داخل رد طلب مصادَق له حق رؤية السجل صاحب الملف. تسريبه يعطي
 * هذا الملف وحده، لساعة على الأكثر.
 */
@Injectable()
export class FileUrlSigner {
  /**
   * المفتاح: FILES_URL_SECRET إن وُجد، وإلا يُشتق من مفتاح الـ JWT (بفصل
   * مجال، فلا يصلح توقيع رابط ملف توكناً ولا العكس).
   */
  private get secret(): string {
    return (
      process.env.FILES_URL_SECRET ||
      createHash('sha256')
        .update(`files-url:${getJwtAccessSecret()}`)
        .digest('hex')
    );
  }

  /** رابط كامل؛ origin = أصل الـ API العام (https://api.example.com) */
  url(
    file: { id: string; originalName: string },
    origin: string,
    nowMs = Date.now(),
  ): string {
    const now = Math.floor(nowMs / 1000);
    const exp = Math.ceil(now / BUCKET_SECONDS) * BUCKET_SECONDS + TTL_SECONDS;
    const name = encodeURIComponent(file.originalName);
    return `${origin}/files/${file.id}/${name}?exp=${exp}&sig=${this.sign(file.id, exp)}`;
  }

  /** صحيح فقط إن كان التوقيع لهذا الملف ولم تنتهِ صلاحيته */
  verify(id: string, exp: unknown, sig: unknown, nowMs = Date.now()): boolean {
    const expiry = Number(exp);
    if (!Number.isInteger(expiry) || typeof sig !== 'string') return false;
    const now = Math.floor(nowMs / 1000);
    if (expiry <= now || expiry > now + TTL_SECONDS + BUCKET_SECONDS) {
      return false;
    }
    const expected = Buffer.from(this.sign(id, expiry));
    const given = Buffer.from(sig);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /** الثواني الباقية قبل انتهاء الرابط (لرأس Cache-Control) */
  remainingSeconds(exp: unknown, nowMs = Date.now()): number {
    return Math.max(0, Number(exp) - Math.floor(nowMs / 1000));
  }

  private sign(id: string, exp: number): string {
    return createHmac('sha256', this.secret)
      .update(`${id}.${exp}`)
      .digest('base64url');
  }
}
