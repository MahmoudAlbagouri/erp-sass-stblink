// src/modules/auth/strategies/access-token.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class AccessTokenStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_ACCESS_SECRET || 'access-secret-key',
    });
  }

  // ✅ إرجاع البيانات كما هي من التوكن - بدون أي استعلام DB
  validate(payload: {
    sub: string;
    tenantId?: string;
    isSuperAdmin: boolean;
    isSystemAdmin: boolean;
    employeeId: string | undefined;
    role?: {
      id: string;
      name: string;
      scope: string;
      permissions?: { name: string; scope: string; tenantId?: string }[];
    };
  }) {
    return {
      id: payload.sub,
      tenantId: payload.tenantId,
      isSuperAdmin: payload.isSuperAdmin,
      isSystemAdmin: payload.isSystemAdmin,
      employeeId: payload.employeeId,
      role: payload.role, // ✅ الدور موجود في التوكن
      permissions: payload.role?.permissions || [], // ✅ الصلاحيات موجودة في التوكن
    };
  }
}
