// src/modules/notifications/scanners/notification-checks.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { AccountingErrorsScanner } from './accounting-errors.scanner';
import { AttendanceDevicesScanner } from './attendance-devices.scanner';
import { HrExpiryScanner } from './hr-expiry.scanner';
import { InvoicesDueScanner } from './invoices-due.scanner';
import { LowStockScanner } from './low-stock.scanner';
import type { NotificationScanner } from './scanner.util';
import { SubscriptionExpiryScanner } from './subscription-expiry.scanner';

export interface ChecksResult {
  ran: string[];
  failed: { check: string; error: string }[];
}

/**
 * تشغيل كل الفحوص الدورية لشركة الآن (بدل انتظار جدولها) — بعد تعديل
 * بيانات كثيرة أو للتأكد. المفاتيح تمنع أي تكرار مع الدورة المجدولة.
 */
@Injectable()
export class NotificationChecksService {
  private readonly logger = new Logger(NotificationChecksService.name);
  private readonly scanners: NotificationScanner[];

  constructor(
    hrExpiry: HrExpiryScanner,
    subscription: SubscriptionExpiryScanner,
    lowStock: LowStockScanner,
    devices: AttendanceDevicesScanner,
    accounting: AccountingErrorsScanner,
    invoices: InvoicesDueScanner,
  ) {
    this.scanners = [
      hrExpiry,
      subscription,
      lowStock,
      devices,
      accounting,
      invoices,
    ];
  }

  async runForTenant(tenantId: string): Promise<ChecksResult> {
    const result: ChecksResult = { ran: [], failed: [] };
    for (const scanner of this.scanners) {
      try {
        await scanner.scanTenant(tenantId);
        result.ran.push(scanner.label);
      } catch (error) {
        const message = (error as Error).message;
        this.logger.error(
          `${scanner.label} failed for ${tenantId}: ${message}`,
        );
        result.failed.push({ check: scanner.label, error: message });
      }
    }
    return result;
  }
}
