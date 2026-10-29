// src/modules/notifications/scanners/scanner.util.ts
import type { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

/** فاحص دوري: يعمل على كل الشركات بجدوله، وعلى شركة واحدة عند الطلب */
export interface NotificationScanner {
  readonly label: string;
  scanTenant(tenantId: string, now?: Date): Promise<void>;
}

/** الفحوص لا تعمل أثناء الاختبارات (تكتب في قاعدة الاختبار في أي لحظة) */
export const scannersDisabled = (): boolean => process.env.NODE_ENV === 'test';

/** يمرّ على كل الشركات: فشل شركة يُسجَّل ولا يوقف البقية */
export async function scanAllTenants(
  dataSource: DataSource,
  scanner: NotificationScanner,
  logger: Logger,
): Promise<void> {
  if (scannersDisabled()) return;
  const tenants = await dataSource.query<{ id: string }[]>(
    `SELECT id FROM tenants`,
  );
  for (const { id } of tenants) {
    try {
      await scanner.scanTenant(id);
    } catch (error) {
      logger.error(
        `${scanner.label} failed for tenant ${id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}

/** فرق الأيام بين يومين (YYYY-MM-DD): b − a */
export const daysBetweenKeys = (a: string, b: string): number =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * المرحلة التي بلغها موعد: أصغر مرحلة ≥ الأيام المتبقية (30، 14، 7…)، أو
 * 'expired' إن مضى منذ أيام قليلة (≤ grace)، أو null إن لم يحن أو مضى زمن.
 */
export function stageOf(
  daysLeft: number,
  stages: number[],
  expiredGraceDays: number | null,
): number | 'expired' | null {
  if (daysLeft < 0) {
    return expiredGraceDays !== null && -daysLeft <= expiredGraceDays
      ? 'expired'
      : null;
  }
  const reached = stages.filter((stage) => daysLeft <= stage);
  return reached.length ? Math.min(...reached) : null;
}

/** «خلال 5 أيام» / «غداً» / «اليوم» / «منذ يومين» */
export function whenText(daysLeft: number): string {
  if (daysLeft === 0) return 'اليوم';
  if (daysLeft === 1) return 'غداً';
  if (daysLeft === -1) return 'أمس';
  const n = Math.abs(daysLeft);
  const unit = n === 2 ? 'يومين' : n <= 10 ? `${n} أيام` : `${n} يوماً`;
  return daysLeft > 0 ? `خلال ${unit}` : `منذ ${unit}`;
}
