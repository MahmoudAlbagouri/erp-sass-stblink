// src/modules/accounting/templates/late-accounts.ts
//
// حسابات نظام أُضيفت لقالب الشجرة بعد أن فعّلت شركات المحاسبة (حسابات الإنتاج):
// تُنشأ لها مرة واحدة تحت أبيها في القالب، بكود القالب إن كان متاحاً وإلا بأول
// كود فارغ تحته. الشركة التي حذفت الأب أو غيّرته لا يُفرض عليها شيء: يفشل
// الترحيل برسالته المعتادة ("أعد إضافته من شجرة الحسابات").
import { EntityManager } from 'typeorm';
import { LATE_SYSTEM_ACCOUNTS } from '../accounting.constants';
import { Account } from '../entities/accounting.entity';
import { buildChartTemplate } from './chart-templates';

export async function ensureLateSystemAccounts(
  manager: EntityManager,
  tenantId: string,
  existing: Map<string, string>,
): Promise<Map<string, string>> {
  const created = new Map<string, string>();
  const [tenant] = await manager.query<{ country: string | null }[]>(
    `SELECT "country" FROM tenants WHERE "id" = $1`,
    [tenantId],
  );
  const template = buildChartTemplate(tenant?.country ?? null);
  const accounts = await manager.find(Account, {
    where: { tenantId },
    select: ['id', 'code', 'type', 'isGroup'],
    withDeleted: true,
  });
  const byCode = new Map(accounts.map((a) => [a.code, a]));

  for (const key of LATE_SYSTEM_ACCOUNTS) {
    if (existing.has(key)) continue;
    const spec = template.find((t) => t.systemKey === key);
    const parent = spec?.parentCode ? byCode.get(spec.parentCode) : undefined;
    if (!spec || !parent) continue;

    let code = spec.code;
    if (byCode.has(code)) {
      const width = spec.code.length - parent.code.length;
      for (let n = 1; n < 10 ** width; n++) {
        const candidate = `${parent.code}${String(n).padStart(width, '0')}`;
        if (!byCode.has(candidate)) {
          code = candidate;
          break;
        }
      }
      if (byCode.has(code)) continue;
    }
    const saved = await manager.save(
      manager.create(Account, {
        tenantId,
        code,
        name: spec.name,
        nameEn: spec.nameEn,
        type: spec.type,
        isGroup: false,
        systemKey: key,
        parentId: parent.id,
      }),
    );
    byCode.set(code, saved);
    created.set(key, saved.id);
  }
  return created;
}
