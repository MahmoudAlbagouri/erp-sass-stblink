import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request } from 'express';

// تأكد أن هذا النوع معرف بوضوح
export interface CurrentUserData {
  id: string;
  tenantId: string;
  isSuperAdmin: boolean;
  isSystemAdmin: boolean;
  employeeId?: string;
  permissions?: string[];
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: CurrentUserData }>();
    const user = request.user;

    if (!user) {
      throw new InternalServerErrorException(
        'User not found in request. Make sure to use JwtAuthGuard before @CurrentUser()',
      );
    }

    return data ? user[data] : user;
  },
);
