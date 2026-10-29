// src/modules/attendance/utils/attendance-pin.ts
// رقم الموظف على جهاز البصمة (PIN). الموظف يُعرف بكوده، وبرقم البصمة المحدد في
// ملفه إن سُجّل على جهاز برقم آخر — أيهما وصل (جهاز قديم بالرقم، وآخر بالكود).
//
// الأجهزة تخزّن الأرقام أعداداً فتحذف أصفار البداية: "0420001" في النظام يصل
// "420001" من الجهاز. لذلك لا يُقارن الرقم كما هو، بل بعد تطبيعه.
import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/** الرقم كما يُقارَن: بلا مسافات، وبلا أصفار بداية إن كان أرقاماً فقط */
export function pinKey(pin: string): string {
  const value = pin.trim();
  return /^\d+$/.test(value) ? value.replace(/^0+/, '') || '0' : value;
}

/** نفس pinKey داخل SQL لعمود أو تعبير نصي (NULL يبقى NULL) */
export function pinKeySql(expression: string): string {
  return `(CASE WHEN btrim(${expression}) ~ '^[0-9]+$'
    THEN COALESCE(NULLIF(ltrim(btrim(${expression}), '0'), ''), '0')
    ELSE btrim(${expression}) END)`;
}

/** الموظف (اسم جدوله alias) يُعرف بهذا المفتاح: بكوده أو برقم بصمته */
function matchesKeySql(alias: string, param: string): string {
  return `(${pinKeySql(`${alias}."employeeCode"`)} ${param}
        OR ${pinKeySql(`${alias}."attendance_pin"`)} ${param})`;
}

/** الرقم الذي يُسجَّل به الموظف على الأجهزة: رقم بصمته إن حُدد، وإلا كوده */
export function employeePin(employee: {
  attendancePin?: string | null;
  employeeCode: string;
}): string {
  return employee.attendancePin?.trim() || employee.employeeCode;
}

/** الموظفون (غير المحذوفين) أصحاب هذه الأرقام: مفتاح الرقم ← معرّف الموظف */
export async function employeesByPin(
  manager: EntityManager,
  tenantId: string,
  pins: string[],
): Promise<Map<string, string>> {
  const keys = [...new Set(pins.map(pinKey))];
  if (keys.length === 0) return new Map();
  const rows = await manager.query<
    { id: string; codeKey: string; pinKey: string | null }[]
  >(
    `SELECT e."id",
            ${pinKeySql('e."employeeCode"')} AS "codeKey",
            ${pinKeySql('e."attendance_pin"')} AS "pinKey"
       FROM employees e
      WHERE e."tenant_id" = $1 AND e."deletedAt" IS NULL
        AND ${matchesKeySql('e', '= ANY($2::text[])')}
      ORDER BY e."createdAt"`,
    [tenantId, keys],
  );
  const map = new Map<string, string>();
  for (const row of rows) {
    for (const key of [row.pinKey, row.codeKey]) {
      if (key && !map.has(key)) map.set(key, row.id);
    }
  }
  return map;
}

/** يرفض رقم بصمة يخص موظفاً آخر في الشركة — رقم بصمته أو كوده (بعد التطبيع) */
export async function assertPinFree(
  manager: EntityManager,
  tenantId: string,
  pin: string,
  exceptEmployeeId?: string,
): Promise<void> {
  const [taken] = await manager.query<{ fullName: string }[]>(
    `SELECT e."fullName" FROM employees e
      WHERE e."tenant_id" = $1 AND e."deletedAt" IS NULL
        AND ($3::uuid IS NULL OR e."id" <> $3::uuid)
        AND ${matchesKeySql('e', '= $2')}
      LIMIT 1`,
    [tenantId, pinKey(pin), exceptEmployeeId ?? null],
  );
  if (taken) {
    throw new ConflictException(
      `رقم البصمة ${pin} مستخدم للموظف ${taken.fullName}`,
    );
  }
}

/**
 * يربط البصمات (والقوالب) التي وصلت بهذا الرقم قبل ربطه بموظف — فما سُجّل
 * قبل تصحيح الربط لا يضيع. يعيد عدد البصمات التي رُبطت.
 */
export async function relinkPunches(
  manager: EntityManager,
  tenantId: string,
  employeeId: string,
  pin: string,
): Promise<number> {
  const key = pinKey(pin);
  const [, affected] = await manager.query<[unknown, number]>(
    `UPDATE attendance_logs SET "employee_id" = $3
      WHERE "tenant_id" = $1 AND "employee_id" IS NULL
        AND ${pinKeySql('"device_user_id"')} = $2`,
    [tenantId, key, employeeId],
  );
  await manager.query(
    `UPDATE biometric_templates SET "employee_id" = $3
      WHERE "tenant_id" = $1 AND "employee_id" IS NULL AND "pin_key" = $2`,
    [tenantId, key, employeeId],
  );
  return affected ?? 0;
}
