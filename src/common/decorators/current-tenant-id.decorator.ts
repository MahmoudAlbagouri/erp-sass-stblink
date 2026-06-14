import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request } from 'express';
import { CurrentUserData } from './current-user.decorator'; // تأكد من استيراد الواجهة

export const CurrentTenantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    // نستخدم نفس الأسلوب: طلب Request يحتوي على user
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: CurrentUserData }>();
    const user = request.user;

    if (!user || !user.tenantId) {
      throw new InternalServerErrorException(
        'TenantId not found. Ensure JwtAuthGuard is used and token contains tenantId',
      );
    }

    return user.tenantId;
  },
);
