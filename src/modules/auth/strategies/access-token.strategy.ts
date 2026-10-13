// src/modules/auth/strategies/access-token.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtAccessSecret } from '../../../config/jwt.config';
import type {
  CurrentUserData,
  JwtPayload,
} from '../../../common/types/auth.types';

@Injectable()
export class AccessTokenStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: getJwtAccessSecret(),
    });
  }

  // ✅ إرجاع البيانات كما هي من التوكن - بدون أي استعلام DB
  validate(payload: JwtPayload): CurrentUserData {
    return {
      id: payload.sub,
      // tenantId يغيب فقط عن مالك النظام (انظر CurrentUserData)
      tenantId: payload.tenantId as string,
      isSuperAdmin: payload.isSuperAdmin,
      isSystemAdmin: payload.isSystemAdmin,
      isDisclaimerAccepted: payload.isDisclaimerAccepted,
      employeeId: payload.employeeId,
      role: payload.role, // ✅ الدور موجود في التوكن
      permissions: payload.role?.permissions?.map((p) => p.name) ?? [], // ✅ أسماء الصلاحيات من التوكن
      supportBy: payload.supportBy,
      country: payload.country,
      currency: payload.currency,
      timezone: payload.timezone,
    };
  }
}
