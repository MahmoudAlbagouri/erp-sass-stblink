// src/common/utils/decimal.transformer.ts
import { ValueTransformer } from 'typeorm';

/**
 * Postgres يعيد أعمدة numeric كنصوص ("12.50") حفاظاً على الدقة.
 * هذا المحوّل يعيدها أرقاماً عند القراءة حتى لا تتسرب نصوص إلى الحسابات
 * أو إلى الـ API (حيث "10" + 5 = "105").
 *
 * مناسب للأسعار والكميات (خانتان إلى أربع خانات عشرية). العمليات الحسابية
 * المتسلسلة على المبالغ تُجرى بـ decimal.js ثم تُخزَّن.
 */
export const decimalTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) =>
    value === null || value === undefined ? value : Number(value),
};
