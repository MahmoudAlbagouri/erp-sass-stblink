/** يزيل المسافات ويحوّل لأحرف كبيرة. يُرجع null إذا كانت القيمة فارغة. */
export function normalizeIban(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, '').toUpperCase();
  return normalized || null;
}
