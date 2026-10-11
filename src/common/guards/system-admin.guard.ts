// src/common/guards/system-admin.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_SYSTEM_ADMIN_KEY } from '../decorators/system-admin.decorator';
import type { AuthenticatedRequest } from '../types/auth.types';

@Injectable()
export class SystemAdminGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // التحقق مما إذا كان الـ Decorator مستخدماً على المسار
    const isSystemAdminRequired = this.reflector.getAllAndOverride<boolean>(
      IS_SYSTEM_ADMIN_KEY,
      [context.getHandler(), context.getClass()],
    );

    // إذا لم يكن مطلوباً، اسمح بالمرور (ليعمل كـ Optional Guard)
    if (!isSystemAdminRequired) return true;

    const request = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();
    const user = request.user;

    if (!user || !user.isSystemAdmin) {
      throw new ForbiddenException('هذه الصلاحية محجوزة لمالك النظام فقط');
    }

    return true;
  }
}
