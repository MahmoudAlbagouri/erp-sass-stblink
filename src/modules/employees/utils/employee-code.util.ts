// src/modules/employees/utils/employee-code.util.ts
import { Repository } from 'typeorm';
import { Employee } from '../entities/employee.entity';

const TENANT_PREFIX_DIGITS = 3;
const SEQUENCE_DIGITS = 4;

/** بادئة ثابتة من 3 أرقام مشتقة من معرّف الشركة */
function getTenantPrefix(tenantId: string): string {
  const mod = 10 ** TENANT_PREFIX_DIGITS;
  let hash = 0;
  for (let i = 0; i < tenantId.length; i++) {
    hash = (hash * 31 + tenantId.charCodeAt(i)) % mod;
  }
  return hash.toString().padStart(TENANT_PREFIX_DIGITS, '0');
}

/**
 * المصدر الوحيد لتوليد كود الموظف (بادئة الشركة + تسلسل من 4 أرقام).
 * مرّر repository مأخوذ من الـ EntityManager عند العمل داخل transaction.
 */
export async function generateEmployeeCode(
  repo: Repository<Employee>,
  tenantId: string,
): Promise<string> {
  const prefix = getTenantPrefix(tenantId);
  const totalLength = TENANT_PREFIX_DIGITS + SEQUENCE_DIGITS;

  const employees = await repo.find({
    where: { tenantId },
    select: ['employeeCode'],
    withDeleted: true,
  });

  let maxNumber = 0;
  for (const emp of employees) {
    const code = emp.employeeCode;
    if (!code) continue;

    if (code.length === totalLength && code.startsWith(prefix)) {
      const num = parseInt(code.slice(TENANT_PREFIX_DIGITS), 10);
      if (!isNaN(num) && num > maxNumber) maxNumber = num;
    }
  }

  const nextNumber = (maxNumber + 1).toString().padStart(SEQUENCE_DIGITS, '0');
  return `${prefix}${nextNumber}`;
}
