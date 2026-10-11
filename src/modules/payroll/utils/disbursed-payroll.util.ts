// src/modules/payroll/utils/disbursed-payroll.util.ts
import { DataSource } from 'typeorm';
import { PayrollItem } from '../entities/payroll-item.entity';

/**
 * ✅ تتحقق هل مستحقات شهر `referenceDate` لهذا الموظف سبق ودُفعت ضمن مسير
 * رواتب تم صرفه — لمنع تعليم مكافأة/تسوية كـ"مصروفة استثنائياً" بعد فوات
 * الأوان (بعد أن دخلت أصلاً ضمن مسير مصروف). لا تمنع الازدواجية المالية
 * الفعلية (فات الأوان على ذلك)، لكنها تمنع تسجيل بيانات صرف كاذبة تُعطي
 * انطباعاً بأن المبلغ صُرف مرتين.
 */
export async function isPaidViaDisbursedPayroll(
  dataSource: DataSource,
  employeeId: string,
  tenantId: string,
  referenceDate: Date,
): Promise<boolean> {
  const month = referenceDate.getMonth() + 1;
  const year = referenceDate.getFullYear();

  const paidItem = await dataSource
    .getRepository(PayrollItem)
    .createQueryBuilder('item')
    .innerJoin('item.payroll', 'payroll')
    .where('item.employeeId = :employeeId', { employeeId })
    .andWhere('payroll.tenantId = :tenantId', { tenantId })
    .andWhere('payroll.month = :month', { month })
    .andWhere('payroll.year = :year', { year })
    .andWhere('payroll.isDisbursed = true')
    .getOne();

  return !!paidItem;
}
