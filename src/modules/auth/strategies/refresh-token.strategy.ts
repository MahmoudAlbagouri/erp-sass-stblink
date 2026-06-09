import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';

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

  validate(req: Request, payload: { sub: string; tenantId: string }) {
    const refreshToken = req
      .get('Authorization')
      ?.replace('Bearer ', '')
      .trim();
    return { ...payload, refreshToken };
  }
}
