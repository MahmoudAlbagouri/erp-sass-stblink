// src/modules/auth/strategies/refresh-token.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtRefreshSecret } from '../../../config/jwt.config';

@Injectable()
export class RefreshTokenStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: getJwtRefreshSecret(),
    });
  }

  /**
   * request.user لمسارات التجديد والخروج: صاحب التوكن وجلسته. التوقيع وحده لا
   * يكفي — الخدمة تتحقق أن الجلسة لم تُلغَ (انظر auth-sessions).
   */
  validate(payload: { sub: string; tenantId?: string; sid?: string }) {
    return {
      id: payload.sub,
      tenantId: payload.tenantId,
      sessionId: payload.sid,
    };
  }
}
