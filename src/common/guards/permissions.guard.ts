// src/common/guards/permissions.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
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
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // إذا لم تكن هناك صلاحيات مطلوبة، اسمح بالمرور
    if (!requiredPermissions || requiredPermissions.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) throw new ForbiddenException('Not authenticated');

    // ✅ 1. مالك النظام يمر دائماً (صلاحيات مطلقة)
    if (user.isSystemAdmin) return true;

    // ✅ 2. مدير الشركة: تحقق أمني قبل السماح
    if (user.isSuperAdmin && user.tenantId) {
      // منع مدير الشركة من الوصول لصلاحيات تبدأ بـ system:
      const hasSystemPermission = requiredPermissions.some((perm) =>
        perm.toLowerCase().startsWith('system:'),
      );

      if (hasSystemPermission) {
        throw new ForbiddenException(
          'هذه الصلاحية محجوزة لمالك النظام وموظفيه فقط',
        );
      }

      // السماح بصلاحيات الشركة العادية
      return true;
    }

    // ✅ 3. الموظفون العاديون: التحقق الدقيق من الصلاحيات في التوكن
    // نجمع الصلاحيات المتاحة للدور (سواء كانت SYSTEM عامة أو TENANT خاصة بالشركة)
    const userPerms = user.role?.permissions || [];

    // استخراج أسماء الصلاحيات للمقارنة
    const userPermNames = userPerms.map((p) => p.name);

    // التحقق من وجود كل الصلاحيات المطلوبة
    const hasAllPermissions = requiredPermissions.every((reqPerm) =>
      userPermNames.includes(reqPerm),
    );

    if (!hasAllPermissions) {
      // لوج تشخيصي لمعرفة سبب الرفض (يمكن حذفه لاحقاً)
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
