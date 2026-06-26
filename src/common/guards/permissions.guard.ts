// src/common/guards/permissions.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import {
  PERMISSIONS_KEY,
  PermissionMetadata,
} from '../decorators/permissions.decorator';
import { PermissionScope } from '../../modules/permissions/entities/permission.entity';

interface AuthenticatedUser {
  id: string;
  tenantId?: string;
  isSuperAdmin: boolean;
  isSystemAdmin: boolean;
  role?: {
    scope: PermissionScope;
    permissions?: {
      name: string;
      scope: PermissionScope;
      tenantId?: string;
    }[];
  };
}

interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
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

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) throw new ForbiddenException('Not authenticated');

    // ✅ 1. مالك النظام يمر دائماً
    if (user.isSystemAdmin) return true;

    // ✅ 2. مدير الشركة: منع صلاحيات system فقط
    if (user.isSuperAdmin && user.tenantId) {
      const hasSystemPermission = requiredPermissions.some((perm) =>
        perm.toLowerCase().startsWith('system:'),
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
      console.log('🚫 Permission Denied:', {
        required: requiredPermissions,
        userHas: userPermNames,
        userId: user.id,
      });

      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
