// src/modules/notifications/notification-audience.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * من يستلم الإشعار، بلغة العمل لا بقائمة معرّفات. كل جمهور يُترجم لمستخدمين
 * فعّالين داخل الشركة فقط (لا يصل إشعار لشركة أخرى أبداً).
 */
export type Audience =
  /** حسابات بعينها */
  | { kind: 'users'; userIds: string[] }
  /** موظفون (عبر حساب الدخول المرتبط بهم؛ من لا حساب له يُتخطّى) */
  | { kind: 'employees'; employeeIds: string[] }
  /**
   * من يملك صلاحية التصرف (ومدير الشركة دائماً). `branchId`: الحدث في فرع —
   * المقيَّد بفروع يستلمه إن كان فرعه، وnull = يستلمه غير المقيَّدين فقط.
   */
  | { kind: 'permission'; permission: string; branchId?: string | null }
  /** مديرو الشركة */
  | { kind: 'admins' }
  /** كل مستخدمي الشركة */
  | { kind: 'all' }
  /** موظفو فروع / أقسام */
  | { kind: 'branches'; branchIds: string[] }
  | { kind: 'departments'; departmentIds: string[] }
  /** مالكو المنصة (إشعارات بلا شركة) */
  | { kind: 'system_admins' };

/** اختصارات تقرأ كجملة: to: [Audience.employee(id), Audience.can(PERMS.X.name)] */
export const Audience = {
  users: (...userIds: (string | null | undefined)[]): Audience => ({
    kind: 'users',
    userIds: userIds.filter((id): id is string => !!id),
  }),
  employee: (employeeId: string): Audience => ({
    kind: 'employees',
    employeeIds: [employeeId],
  }),
  employees: (employeeIds: string[]): Audience => ({
    kind: 'employees',
    employeeIds,
  }),
  can: (permission: string, branchId?: string | null): Audience => ({
    kind: 'permission',
    permission,
    branchId,
  }),
  admins: (): Audience => ({ kind: 'admins' }),
  all: (): Audience => ({ kind: 'all' }),
  systemAdmins: (): Audience => ({ kind: 'system_admins' }),
};

/** مستخدم فعّال: غير محذوف، وحالته active */
const ACTIVE_USER = `u.deleted_at IS NULL AND u.status = 'active'`;

@Injectable()
export class NotificationAudienceService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** معرّفات المستخدمين (بلا تكرار) لكل الجماهير معاً */
  async resolve(
    tenantId: string | null,
    audiences: Audience[],
  ): Promise<string[]> {
    const ids = new Set<string>();
    for (const audience of audiences) {
      for (const id of await this.resolveOne(tenantId, audience)) ids.add(id);
    }
    return [...ids];
  }

  /** موظفون لا حساب دخول لهم — لا يصلهم شيء (تعرضهم شاشة الإرسال) */
  async employeesWithoutAccount(
    tenantId: string,
    employeeIds: string[],
  ): Promise<{ id: string; fullName: string; employeeCode: string }[]> {
    if (employeeIds.length === 0) return [];
    return this.dataSource.query(
      `SELECT e.id, e."fullName", e."employeeCode"
         FROM employees e
         LEFT JOIN users u ON u.id = e.user_id AND ${ACTIVE_USER}
        WHERE e.tenant_id = $1 AND e.id = ANY($2::uuid[])
          AND e."deletedAt" IS NULL AND u.id IS NULL
        ORDER BY e."fullName"`,
      [tenantId, employeeIds],
    );
  }

  /** موظفو فروع / أقسام (قبل تحويلهم لحسابات) — لشاشة الإرسال وللجمهور */
  async employeeIdsOf(
    tenantId: string,
    filter: { branchIds?: string[]; departmentIds?: string[] },
  ): Promise<string[]> {
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT e.id FROM employees e
        WHERE e.tenant_id = $1 AND e."deletedAt" IS NULL
          AND e.status = 'active'
          AND ($2::uuid[] IS NULL OR e.branch_id = ANY($2::uuid[]))
          AND ($3::uuid[] IS NULL OR e.department_id = ANY($3::uuid[]))`,
      [tenantId, filter.branchIds ?? null, filter.departmentIds ?? null],
    );
    return rows.map((r) => r.id);
  }

  private async resolveOne(
    tenantId: string | null,
    audience: Audience,
  ): Promise<string[]> {
    if (audience.kind === 'system_admins') {
      return this.ids(
        `SELECT u.id FROM users u WHERE u."isSystemAdmin" AND ${ACTIVE_USER}`,
        [],
      );
    }
    // كل ما عدا مالكي المنصة جمهور داخل شركة
    if (!tenantId) return [];

    switch (audience.kind) {
      case 'users':
        if (audience.userIds.length === 0) return [];
        return this.ids(
          `SELECT u.id FROM users u
            WHERE u.tenant_id = $1 AND u.id = ANY($2::uuid[]) AND ${ACTIVE_USER}`,
          [tenantId, audience.userIds],
        );

      case 'employees':
        if (audience.employeeIds.length === 0) return [];
        return this.ids(
          `SELECT u.id FROM employees e
             JOIN users u ON u.id = e.user_id
            WHERE e.tenant_id = $1 AND e.id = ANY($2::uuid[])
              AND e."deletedAt" IS NULL AND ${ACTIVE_USER}`,
          [tenantId, audience.employeeIds],
        );

      case 'permission':
        return this.ids(
          `SELECT u.id FROM users u
            WHERE u.tenant_id = $1 AND ${ACTIVE_USER}
              AND (u."isSuperAdmin" OR EXISTS (
                    SELECT 1 FROM roles_permissions_permissions rp
                      JOIN permissions p ON p.id = rp."permissionsId"
                     WHERE rp."rolesId" = u.role_id AND p.name = $2))
              AND ($3::boolean = false OR u."isSuperAdmin"
                   OR NOT EXISTS (SELECT 1 FROM user_branches ub WHERE ub.user_id = u.id)
                   OR EXISTS (SELECT 1 FROM user_branches ub
                               WHERE ub.user_id = u.id AND ub.branch_id = $4::uuid))`,
          [
            tenantId,
            audience.permission,
            audience.branchId !== undefined,
            audience.branchId ?? null,
          ],
        );

      case 'admins':
        return this.ids(
          `SELECT u.id FROM users u
            WHERE u.tenant_id = $1 AND u."isSuperAdmin" AND ${ACTIVE_USER}`,
          [tenantId],
        );

      case 'all':
        return this.ids(
          `SELECT u.id FROM users u WHERE u.tenant_id = $1 AND ${ACTIVE_USER}`,
          [tenantId],
        );

      case 'branches':
      case 'departments': {
        const employeeIds = await this.employeeIdsOf(
          tenantId,
          audience.kind === 'branches'
            ? { branchIds: audience.branchIds }
            : { departmentIds: audience.departmentIds },
        );
        return this.resolveOne(tenantId, { kind: 'employees', employeeIds });
      }
    }
  }

  private async ids(sql: string, params: unknown[]): Promise<string[]> {
    const rows: { id: string }[] = await this.dataSource.query(sql, params);
    return rows.map((r) => r.id);
  }
}
