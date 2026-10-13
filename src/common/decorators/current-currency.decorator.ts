import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../types/auth.types';
import { getCountry } from '../constants/countries';

/**
 * عملة شركة المستخدم الحالي (ISO 4217) كما يحملها التوكن — بلا استعلام DB.
 * التوكنات الصادرة قبل دعم تعدد الدول لا تحمل العملة: تُعامل بالافتراضية.
 */
export const CurrentCurrency = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();
    return request.user?.currency ?? getCountry().currency;
  },
);
