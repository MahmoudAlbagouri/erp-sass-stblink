// src/common/guards/tenant-scope.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../types/auth.types';

/**
 * للمسارات التي تعمل على بيانات شركة (أصناف، مخزون، مشتريات، مبيعات، كاشير):
 * تشترط أن يكون للمستخدم شركة.
 *
 * مالك النظام يمرّ من حارسي الاشتراك والصلاحيات لكنه بلا شركة (tenantId)،
 * فبدون هذا الحارس تصل العملية للقاعدة بـ tenantId فارغ وتفشل بخطأ 500 غير
 * مفهوم. هنا يُرفض بوضوح قبل أن يبدأ أي شيء.
 *
 * يوضع بعد JwtAuthGuard مباشرة.
 */
@Injectable()
export class TenantScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();

    if (!user?.tenantId) {
      throw new ForbiddenException(
        'هذه الصفحة خاصة بحسابات الشركات — سجّل الدخول بحساب مدير الشركة أو أحد موظفيها',
      );
    }
    return true;
  }
}
