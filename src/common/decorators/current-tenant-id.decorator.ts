import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request } from 'express';
import { CurrentUserData } from './current-user.decorator';

export const CurrentTenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: CurrentUserData }>();
    const user = request.user;

    // ✅ إضافة استثناء لمالك النظام: إذا كان SystemAdmin فلا يشترط وجود tenantId
    if (user && user.isSystemAdmin) {
      return null; // أو يمكنك إرجاع 'system' أو أي قيمة تدل على أنه مدير النظام
    }

    if (!user || !user.tenantId) {
      throw new InternalServerErrorException(
        'TenantId not found. Ensure JwtAuthGuard is used and token contains tenantId',
      );
    }

    return user.tenantId;
  },
);
