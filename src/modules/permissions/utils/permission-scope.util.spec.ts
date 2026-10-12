import { Permission, PermissionScope } from '../entities/permission.entity';
import {
  filterTenantAssignablePermissions,
  isSystemPermission,
} from './permission-scope.util';

const perm = (
  name: string,
  scope: PermissionScope,
  tenantId: string | null,
): Permission => ({ id: name, name, scope, tenantId }) as Permission;

describe('isSystemPermission', () => {
  it('detects system permissions by scope or by name prefix', () => {
    expect(isSystemPermission(perm('x', PermissionScope.SYSTEM, null))).toBe(
      true,
    );
    expect(
      isSystemPermission(
        perm('system:plans:view', PermissionScope.TENANT, null),
      ),
    ).toBe(true);
    expect(
      isSystemPermission(perm('view_users', PermissionScope.TENANT, null)),
    ).toBe(false);
  });
});

describe('filterTenantAssignablePermissions (tenant isolation)', () => {
  const all = [
    perm('view_users', PermissionScope.TENANT, null), // عامة
    perm('custom_own', PermissionScope.TENANT, 'tenant-a'), // خاصة بالشركة
    perm('custom_other', PermissionScope.TENANT, 'tenant-b'), // شركة أخرى
    perm('system:plans:view', PermissionScope.SYSTEM, null), // نظام
  ];

  it('keeps global and own-tenant permissions only', () => {
    const names = filterTenantAssignablePermissions(all, 'tenant-a').map(
      (p) => p.name,
    );
    expect(names).toEqual(['view_users', 'custom_own']);
  });

  it('never lets a tenant assign system or foreign permissions', () => {
    const names = filterTenantAssignablePermissions(all, 'tenant-a').map(
      (p) => p.name,
    );
    expect(names).not.toContain('system:plans:view');
    expect(names).not.toContain('custom_other');
  });
});
