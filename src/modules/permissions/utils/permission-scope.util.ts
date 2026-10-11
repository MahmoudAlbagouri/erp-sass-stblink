// src/modules/permissions/utils/permission-scope.util.ts
import { Permission, PermissionScope } from '../entities/permission.entity';

export const SYSTEM_PERMISSION_PREFIX = 'system:';

export const isSystemPermission = (
  permission: Pick<Permission, 'name' | 'scope'>,
): boolean =>
  permission.scope === PermissionScope.SYSTEM ||
  permission.name.startsWith(SYSTEM_PERMISSION_PREFIX);

/**
 * الصلاحيات التي يحق لشركة (tenant) إسنادها لأدوارها:
 * الصلاحيات العامة غير الخاصة بالنظام + صلاحيات الشركة نفسها فقط.
 */
export function filterTenantAssignablePermissions(
  permissions: Permission[],
  tenantId: string,
): Permission[] {
  return permissions.filter(
    (p) => !isSystemPermission(p) && (!p.tenantId || p.tenantId === tenantId),
  );
}
