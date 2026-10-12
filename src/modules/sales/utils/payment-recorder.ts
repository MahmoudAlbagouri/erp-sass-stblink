// src/modules/sales/utils/payment-recorder.ts
import { EntityManager } from 'typeorm';
import { nextDocumentNumber } from '../../../common/utils/document-number.util';
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
  direction: PaymentDirection;
  paymentDate: string;
  amount: number;
  method: SalesPaymentMethod;
  reference?: string | null;
  note?: string | null;
  createdById?: string | null;
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
    }),
  );
}

/** تاريخ اليوم (YYYY-MM-DD) لوقت معيّن، بتوقيت السيرفر */
export function dateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
