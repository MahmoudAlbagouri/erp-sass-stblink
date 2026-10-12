// src/modules/sales/utils/zatca.util.ts
// متطلبات هيئة الزكاة والضريبة (ZATCA) — المرحلة الأولى: رمز QR على الفاتورة.
import { createHash } from 'crypto';

export interface ZatcaQrInput {
  /** اسم البائع كما في شهادة التسجيل الضريبي */
  sellerName: string;
  /** الرقم الضريبي للبائع (15 رقماً) */
  taxNumber: string;
  /** وقت إصدار الفاتورة */
  issuedAt: Date;
  /** إجمالي الفاتورة شاملاً الضريبة */
  total: number;
  /** إجمالي الضريبة */
  taxTotal: number;
}

/** حقل TLV: بايت للرقم، بايت للطول، ثم القيمة UTF-8 */
function tlv(tag: number, value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > 255) {
    throw new Error(`ZATCA QR field ${tag} is longer than 255 bytes`);
  }
  return Buffer.concat([Buffer.from([tag, bytes.length]), bytes]);
}

/**
 * رمز QR للمرحلة الأولى: خمسة حقول بترميز TLV ثم Base64 —
 * (1) اسم البائع (2) رقمه الضريبي (3) وقت الفاتورة (4) الإجمالي شامل الضريبة
 * (5) إجمالي الضريبة. يقرؤه تطبيق الهيئة وأي قارئ فواتير.
 */
export function buildZatcaQr(input: ZatcaQrInput): string {
  return Buffer.concat([
    tlv(1, input.sellerName),
    tlv(2, input.taxNumber),
    // ISO 8601 بتوقيت UTC بلا أجزاء الثانية: 2026-10-12T09:30:00Z
    tlv(3, input.issuedAt.toISOString().replace(/\.\d{3}Z$/, 'Z')),
    tlv(4, input.total.toFixed(2)),
    tlv(5, input.taxTotal.toFixed(2)),
  ]).toString('base64');
}

/** يفكّ رمز QR إلى حقوله (للاختبارات والتحقق) */
export function parseZatcaQr(qr: string): Record<number, string> {
  const bytes = Buffer.from(qr, 'base64');
  const fields: Record<number, string> = {};
  let offset = 0;
  while (offset < bytes.length) {
    const tag = bytes[offset];
    const length = bytes[offset + 1];
    fields[tag] = bytes
      .subarray(offset + 2, offset + 2 + length)
      .toString('utf8');
    offset += 2 + length;
  }
  return fields;
}

export interface InvoiceHashInput {
  uuid: string;
  number: string;
  issuedAt: Date;
  total: number;
  taxTotal: number;
  /** بصمة الفاتورة السابقة في التسلسل ('' لأول فاتورة) */
  previousHash: string;
}

/**
 * بصمة الفاتورة (SHA-256) مربوطة ببصمة التي قبلها: حذف فاتورة أو تعديل
 * مبالغها يكسر السلسلة فيُكتشف.
 *
 * ملاحظة: المرحلة الثانية (الربط) تحسب البصمة على ملف XML الموقَّع بصيغة
 * الهيئة؛ هذه البصمة الداخلية تمهّد لها وتُبقي التسلسل محمياً من الآن.
 */
export function computeInvoiceHash(input: InvoiceHashInput): string {
  return createHash('sha256')
    .update(
      [
        input.uuid,
        input.number,
        input.issuedAt.toISOString(),
        input.total.toFixed(2),
        input.taxTotal.toFixed(2),
        input.previousHash,
      ].join('|'),
    )
    .digest('hex');
}
