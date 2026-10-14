// src/modules/sales/utils/payment-recorder.ts
import { EntityManager } from 'typeorm';
import { nextDocumentNumber } from '../../../common/utils/document-number.util';
import { dayKeyInZone } from '../../../common/utils/timezone.util';
import { currentBranchScope } from '../../branches/branch-scope';
import { ensureMainBranch } from '../../branches/branches.util';
import {
  CustomerPayment,
  PaymentDirection,
  SalesPaymentMethod,
} from '../entities/customer-payment.entity';

const NUMBER_PREFIX = 'RC-';

export interface PaymentRecord {
  customerId?: string | null;
  invoiceId?: string | null;
  salesReturnId?: string | null;
  /** لدفعة على الحساب فقط: مع فاتورة أو مرتجع يُؤخذ الفرع من مخزنهما */
  branchId?: string | null;
  direction: PaymentDirection;
  paymentDate: string;
  amount: number;
  method: SalesPaymentMethod;
  reference?: string | null;
  note?: string | null;
  createdById?: string | null;
  /** وردية الكاشير التي دخل المبلغ درجها أو خرج منه */
  shiftId?: string | null;
}

/**
 * يكتب حركة نقدية مع عميل داخل معاملة المستدعي. دالة مجردة (لا خدمة) لأن
 * ثلاثة أماكن تحتاجها — إصدار الفاتورة، إصدار المرتجع، وشاشة المقبوضات —
 * ولا يصح أن تعتمد خدماتها على بعضها دائرياً.
 *
 * لا تعدّل مبالغ الفاتورة: هذا على المستدعي، وهو من يملك قفلها.
 */
export async function recordPayment(
  manager: EntityManager,
  tenantId: string,
  record: PaymentRecord,
): Promise<CustomerPayment> {
  return manager.save(
    manager.create(CustomerPayment, {
      tenantId,
      number: await nextDocumentNumber(
        manager,
        'customer_payments',
        NUMBER_PREFIX,
        tenantId,
      ),
      branchId: await branchOf(manager, tenantId, record),
      customerId: record.customerId ?? null,
      invoiceId: record.invoiceId ?? null,
      salesReturnId: record.salesReturnId ?? null,
      direction: record.direction,
      paymentDate: record.paymentDate,
      amount: record.amount,
      method: record.method,
      reference: record.reference ?? null,
      note: record.note ?? null,
      createdById: record.createdById ?? null,
      shiftId: record.shiftId ?? null,
    }),
  );
}

/**
 * فرع الحركة: فرع مخزن الفاتورة (أو المرتجع). دفعة على الحساب بلا مستند:
 * الفرع المختار، وإلا فرع المستخدم المقيَّد، وإلا الرئيسي.
 */
async function branchOf(
  manager: EntityManager,
  tenantId: string,
  record: PaymentRecord,
): Promise<string> {
  const source = record.invoiceId
    ? { table: 'sales_invoices', id: record.invoiceId }
    : record.salesReturnId
      ? { table: 'sales_returns', id: record.salesReturnId }
      : null;

  if (source) {
    const [row] = await manager.query<{ branchId: string }[]>(
      `SELECT w."branchId" FROM ${source.table} d
         JOIN warehouses w ON w.id = d."warehouseId"
        WHERE d.id = $1 AND d."tenantId" = $2`,
      [source.id, tenantId],
    );
    if (row) return row.branchId;
  }

  return (
    record.branchId ??
    currentBranchScope()?.branchIds[0] ??
    (await ensureMainBranch(manager, tenantId)).id
  );
}

/**
 * تاريخ المستند (YYYY-MM-DD) للحظة معيّنة بتوقيت الشركة — لا السيرفر: بيع
 * الساعة 1:30 فجراً بالرياض يوم 15 تاريخه 15 ولو كانت ساعة السيرفر (UTC) ما
 * زالت في 14. المنطقة من tenantTimezoneOf.
 */
export function dateOnly(date: Date, zone: string): string {
  return dayKeyInZone(date, zone);
}
