// src/modules/attendance/utils/zk-protocol.ts
// صيغ أوامر وسجلات بروتوكول ZKTeco Push. الأوامر تُحفظ بصيغة Push 2.x فأحدث
// (DATA UPDATE …) وتُترجم عند الإرسال للأجهزة القديمة (DATA USER …).
import { TemplateKind } from '../entities/biometric-template.entity';

/** حقول الأمر يفصلها tab وينتهي بسطر جديد: محرف منها داخل قيمة يكسر الأمر */
function clean(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').trim();
}

/**
 * يطلب من الجهاز إعداداته من جديد (كما بعد تشغيله)، فيعرّف نفسه ويعلن إصداره.
 * تفهمه كل الإصدارات، ويرد عليه بـ Return=1.
 */
export const CHECK_COMMAND = 'CHECK';

/** تسجيل موظف على الجهاز (أو تحديث اسمه) */
export function userInfoCommand(pin: string, name: string): string {
  return `DATA UPDATE USERINFO PIN=${clean(pin)}\tName=${clean(name)}\tPri=0`;
}

const TEMPLATE_TABLES: Record<TemplateKind, { table: string; pin: string }> = {
  [TemplateKind.FINGER]: { table: 'FINGERTMP', pin: 'PIN' },
  [TemplateKind.FACE]: { table: 'FACE', pin: 'PIN' },
  [TemplateKind.BIODATA]: { table: 'BIODATA', pin: 'Pin' },
};

/** إرسال قالب بصمة محفوظ للجهاز باسم رقم الموظف عليه */
export function templateCommand(
  pin: string,
  kind: TemplateKind,
  fields: string,
): string {
  const { table, pin: pinField } = TEMPLATE_TABLES[kind];
  return `DATA UPDATE ${table} ${pinField}=${clean(pin)}\t${fields}`;
}

/** أجهزة Push 1.x، أو التي لا تعلن إصدارها، تفهم الصيغة القديمة */
export function isLegacyPush(version?: string | null): boolean {
  const major = Number.parseInt(version ?? '', 10);
  return !Number.isFinite(major) || major < 2;
}

const LEGACY_PREFIXES: [modern: string, legacy: string][] = [
  ['DATA UPDATE USERINFO ', 'DATA USER '],
  ['DATA UPDATE FINGERTMP ', 'DATA FP '],
  ['DATA DELETE USERINFO ', 'DATA DEL_USER '],
];

/** الأمر بالصيغة التي يفهمها إصدار الجهاز */
export function commandForDevice(
  command: string,
  pushVersion?: string | null,
): string {
  if (!isLegacyPush(pushVersion)) return command;
  for (const [modern, legacy] of LEGACY_PREFIXES) {
    if (command.startsWith(modern)) {
      return legacy + command.slice(modern.length);
    }
  }
  return command;
}

export interface TemplateRecord {
  kind: TemplateKind;
  pin: string;
  /** موضع القالب: رقم الإصبع، أو النوع:الرقم:الفهرس */
  slot: string;
  /** حقول السجل عدا الرقم، بترتيبها كما أرسلها الجهاز */
  fields: string;
}

/**
 * سطر قالب من سجل العمليات (OPERLOG) أو BIODATA، مثل:
 * `FP PIN=1\tFID=6\tSize=1184\tValid=1\tTMP=…`. غيره (USER، OPLOG…) يعيد null.
 */
export function parseTemplateLine(line: string): TemplateRecord | null {
  const text = line.trim();
  const space = text.indexOf(' ');
  if (space < 0) return null;
  const keyword = text.slice(0, space).toUpperCase();
  const kind = Object.values(TemplateKind).find(
    (k) => (k as string) === keyword,
  );
  if (!kind) return null;

  const fields = text
    .slice(space + 1)
    .split('\t')
    .map((part) => {
      const eq = part.indexOf('=');
      return eq < 0
        ? null
        : { key: part.slice(0, eq).trim(), value: part.slice(eq + 1) };
    })
    .filter((f): f is { key: string; value: string } => !!f && !!f.key);
  const get = (name: string) =>
    fields.find((f) => f.key.toLowerCase() === name.toLowerCase())?.value;

  const pin = get('PIN')?.trim();
  const template = get('TMP');
  if (!pin || !template) return null;

  const slot =
    kind === TemplateKind.BIODATA
      ? `${get('Type') ?? 0}:${get('No') ?? 0}:${get('Index') ?? 0}`
      : (get('FID') ?? '0');

  return {
    kind,
    pin,
    slot: slot.slice(0, 20),
    fields: fields
      .filter((f) => f.key.toLowerCase() !== 'pin')
      .map((f) => `${f.key}=${f.value}`)
      .join('\t'),
  };
}
