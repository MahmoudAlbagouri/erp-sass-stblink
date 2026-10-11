// src/common/guards/permissions.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS_KEY,
  PermissionMetadata,
} from '../decorators/permissions.decorator';
import type { AuthenticatedRequest } from '../types/auth.types';
import { SYSTEM_PERMISSION_PREFIX } from '../../modules/permissions/utils/permission-scope.util';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const rawPermissions = this.reflector.getAllAndOverride<
      (string | PermissionMetadata)[]
    >(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!rawPermissions || rawPermissions.length === 0) return true;

    // ✅ استخراج أسماء الصلاحيات سواء كانت string أو PermissionMetadata
    const requiredPermissions = rawPermissions.map((p) =>
      typeof p === 'string' ? p : p.name,
    );

    const request = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();
    const user = request.user;

    if (!user) throw new ForbiddenException('Not authenticated');

    // ✅ 1. مالك النظام يمر دائماً
    if (user.isSystemAdmin) return true;

    // ✅ 2. مدير الشركة: منع صلاحيات system فقط
    if (user.isSuperAdmin && user.tenantId) {
      const hasSystemPermission = requiredPermissions.some((perm) =>
        perm.toLowerCase().startsWith(SYSTEM_PERMISSION_PREFIX),
      );

      if (hasSystemPermission) {
        throw new ForbiddenException(
          'هذه الصلاحية محجوزة لمالك النظام وموظفيه فقط',
        );
      }

      return true;
    }

    // ✅ 3. الموظفون العاديون: التحقق الدقيق
    const userPermNames = (user.role?.permissions || []).map((p) => p.name);

    const hasAllPermissions = requiredPermissions.every((reqPerm) =>
      userPermNames.includes(reqPerm),
    );

    if (!hasAllPermissions) {
      this.logger.warn(
        `Permission denied for user ${user.id}: requires [${requiredPermissions.join(', ')}]`,
      );

      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
