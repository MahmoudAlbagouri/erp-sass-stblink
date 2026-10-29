// src/modules/attendance/utils/ip-allowlist.ts
// قفل الجهاز على عناوين IP: الجهاز يُعرَّف برقمه التسلسلي فقط (مكتوب على
// ملصقه)، فالعنوان هو ما يمنع غيره من انتحاله.
import { BlockList, isIP } from 'net';

/** عنوان IPv4 داخل IPv6 (‎::ffff:1.2.3.4) كما يصل من بعض الشبكات */
export function normalizeIp(ip?: string | null): string | null {
  const value = ip?.trim();
  if (!value) return null;
  return value.toLowerCase().startsWith('::ffff:') && isIP(value.slice(7)) === 4
    ? value.slice(7)
    : value;
}

/** عناصر القائمة بعد التنظيف؛ ترمي بأول عنصر غير صالح */
export function parseAllowedIps(raw?: string | null): string[] {
  const entries = (raw ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const [address, prefix] = entry.split('/');
    const family = isIP(address);
    const maxPrefix = family === 4 ? 32 : 128;
    const validPrefix =
      prefix === undefined ||
      (/^\d{1,3}$/.test(prefix) && Number(prefix) <= maxPrefix);
    if (!family || !validPrefix) {
      throw new Error(entry);
    }
  }
  return entries;
}

/** هل العنوان ضمن القائمة؟ قائمة فارغة = مسموح */
export function ipAllowed(ip: string | null, raw?: string | null): boolean {
  const entries = parseAllowedIps(raw);
  if (entries.length === 0) return true;
  const address = normalizeIp(ip);
  if (!address || !isIP(address)) return false;

  const list = new BlockList();
  for (const entry of entries) {
    const [base, prefix] = entry.split('/');
    const type = isIP(base) === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) list.addAddress(base, type);
    else list.addSubnet(base, Number(prefix), type);
  }
  return list.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');
}
