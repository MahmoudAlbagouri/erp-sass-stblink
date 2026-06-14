import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';

// src/modules/auth/strategies/refresh-token.strategy.ts

@Injectable()
export class RefreshTokenStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_REFRESH_SECRET || 'super-secret-refresh-key',
      passReqToCallback: true,
    });
  }

  // ✅ التعديل هنا لضمان إرجاع الـ tenantId
  validate(req: Request, payload: { sub: string; tenantId: string }) {
    const refreshToken = req
      .get('Authorization')
      ?.replace('Bearer ', '')
      .trim();

    // هذا الكائن هو الذي سيتم وضعه في request.user
    return {
      id: payload.sub,
      tenantId: payload.tenantId, // تأكد من تمريره هنا
      refreshToken,
    };
  }
}
