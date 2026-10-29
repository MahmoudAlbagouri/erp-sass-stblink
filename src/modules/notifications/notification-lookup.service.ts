// src/modules/notifications/notification-lookup.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { getCountry } from '../../common/constants/countries';
import { isValidTimezone } from '../../common/utils/timezone.util';
import {
  formatDate,
  formatDateTime,
  formatMoney,
} from '../../common/utils/format.util';
import type { NotificationDetail } from './entities/notification.entity';

export interface EmployeeRef {
  id: string;
  fullName: string;
  employeeCode: string;
  branchId: string | null;
  /** حساب الدخول المرتبط (null = لا يصله شيء) */
  userId: string | null;
}

export interface TenantLocaleRef {
  zone: string;
  currency: string;
}

/** تاريخ يوم (YYYY-MM-DD) للعرض: 10/4/2026 — بلا إزاحة منطقة السيرفر */
export const dayText = (day: string | Date): string =>
  formatDate(
    typeof day === 'string' ? `${day.slice(0, 10)}T00:00:00Z` : day,
    'UTC',
  );

/** YYYY-MM-DD من قيمة عمود date (نص أو Date) */
export const dayKey = (value: string | Date): string =>
  typeof value === 'string'
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10);

export const employeeDetail = (employee: EmployeeRef): NotificationDetail => ({
  label: 'الموظف',
  value: `${employee.fullName} (${employee.employeeCode})`,
});

/**
 * ما تحتاجه المستمعات لصياغة الإشعار: اسم الموظف وفرعه وحسابه، ومنطقة
 * الشركة وعملتها للنصوص.
 */
@Injectable()
export class NotificationLookupService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async employee(
    tenantId: string,
    employeeId: string,
  ): Promise<EmployeeRef | null> {
    const rows = await this.dataSource.query<EmployeeRef[]>(
      `SELECT e.id, e."fullName", e."employeeCode",
              e.branch_id AS "branchId", e.user_id AS "userId"
         FROM employees e
        WHERE e.id = $1 AND e.tenant_id = $2`,
      [employeeId, tenantId],
    );
    return rows[0] ?? null;
  }

  async employees(
    tenantId: string,
    employeeIds: string[],
  ): Promise<Map<string, EmployeeRef>> {
    if (employeeIds.length === 0) return new Map();
    const rows = await this.dataSource.query<EmployeeRef[]>(
      `SELECT e.id, e."fullName", e."employeeCode",
              e.branch_id AS "branchId", e.user_id AS "userId"
         FROM employees e
        WHERE e.id = ANY($1::uuid[]) AND e.tenant_id = $2`,
      [employeeIds, tenantId],
    );
    return new Map(rows.map((r) => [r.id, r]));
  }

  async warehouse(
    tenantId: string,
    warehouseId: string,
  ): Promise<{ id: string; name: string; branchId: string | null } | null> {
    const rows = await this.dataSource.query<
      { id: string; name: string; branchId: string | null }[]
    >(
      `SELECT id, name, "branchId" FROM warehouses
        WHERE id = $1 AND "tenantId" = $2`,
      [warehouseId, tenantId],
    );
    return rows[0] ?? null;
  }

  async userName(userId: string | null | undefined): Promise<string | null> {
    if (!userId) return null;
    const rows = await this.dataSource.query<{ name: string }[]>(
      `SELECT COALESCE(e."fullName", u.username) AS name
         FROM users u
         LEFT JOIN employees e ON e.user_id = u.id AND e."deletedAt" IS NULL
        WHERE u.id = $1`,
      [userId],
    );
    return rows[0]?.name ?? null;
  }

  async companyName(tenantId: string): Promise<string | null> {
    const rows = await this.dataSource.query<{ companyName: string }[]>(
      `SELECT "companyName" FROM tenants WHERE id = $1`,
      [tenantId],
    );
    return rows[0]?.companyName ?? null;
  }

  async locale(tenantId: string): Promise<TenantLocaleRef> {
    const rows = await this.dataSource.query<
      {
        country: string | null;
        currency: string | null;
        timezone: string | null;
      }[]
    >(`SELECT country, currency, timezone FROM tenants WHERE id = $1`, [
      tenantId,
    ]);
    const country = getCountry(rows[0]?.country);
    return {
      zone: isValidTimezone(rows[0]?.timezone)
        ? rows[0].timezone
        : country.timezone,
      currency: rows[0]?.currency ?? country.currency,
    };
  }

  /** مبلغ بعملة الشركة للنص: 1,500.00 ر.س */
  async money(tenantId: string, amount: number): Promise<string> {
    return formatMoney(amount, (await this.locale(tenantId)).currency);
  }

  /** لحظة بتوقيت الشركة للنص */
  async dateTime(tenantId: string, at: Date): Promise<string> {
    return formatDateTime(at, (await this.locale(tenantId)).zone);
  }
}
