import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type {
  AuthenticatedRequest,
  CurrentUserData,
} from '../types/auth.types';

// يُعاد تصديره من هنا للإبقاء على مسار الاستيراد المستخدم في الموديولات
export type { CurrentUserData };

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();
    const user = request.user;

    if (!user) {
      throw new InternalServerErrorException(
        'User not found in request. Make sure to use JwtAuthGuard before @CurrentUser()',
      );
    }

    return data ? user[data] : user;
  },
);
