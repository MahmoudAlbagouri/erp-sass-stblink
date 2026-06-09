// src/common/guards/system-admin.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express'; // ✅ استيراد Request من express
import { IS_SYSTEM_ADMIN_KEY } from '../decorators/system-admin.decorator';

// ✅ تعريف واجهة المستخدم المتوقع وجوده في الـ Request
interface RequestWithUser extends Request {
  user?: {
    isSystemAdmin: boolean;
  };
}

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

    // ✅ تحديد النوع الصريح للـ Request باستخدام الواجهة المعرفة أعلاه
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    // ✅ الآن المترجم يعرف أن user يحتوي على isSystemAdmin
    if (!user || !user.isSystemAdmin) {
      throw new ForbiddenException('هذه الصلاحية محجوزة لمالك النظام فقط');
    }

    return true;
  }
}
