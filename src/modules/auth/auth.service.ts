// src/modules/auth/auth.service.ts
import {
  Injectable,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import * as argon2 from 'argon2';

import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  TenantStatus,
  SubscriptionPlan,
} from '../../common/enums/tenant.enums';
import { UserStatus } from '../../common/enums/user.enums';

interface ResetTokenPayload {
  sub: string;
  type: 'reset';
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    @InjectEntityManager()
    private entityManager: EntityManager,
  ) {}

  // في register() - استبدل المتغيرات الاختيارية بـ assertion pattern أنظف
  async register(dto: RegisterDto) {
    const existingUser = await this.usersService.findOneByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException('البريد الإلكتروني مستخدم بالفعل');
    }

    // ✅ استخدام object بدلاً من متغيرات منفصلة
    const result = {
      userId: '',
      tenantId: '',
      email: '',
    };

    await this.entityManager.transaction(async (manager) => {
      const tenant = manager.create(Tenant, {
        company_name: dto.companyName,
        phone: dto.phone,
        address: dto.address,
        subscription_plan: SubscriptionPlan.FREE,
        status: TenantStatus.TRIAL,
        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        max_users: 5,
        storage_limit_mb: 1000,
        language: 'ar',
        timezone: 'UTC+3',
      });
      await manager.save(tenant);

      const hashedPassword = await argon2.hash(dto.password);
      const admin = manager.create(User, {
        username: dto.username,
        email: dto.email,
        password: hashedPassword,
        tenantId: tenant.id,
        isSuperAdmin: true,
        status: UserStatus.ACTIVE,
      });
      await manager.save(admin);

      // ✅ تعيين مباشر بدون undefined
      result.userId = admin.id;
      result.tenantId = tenant.id;
      result.email = admin.email;
    });

    const tokens = await this.getTokens(result.userId);

    return {
      message: 'تم إنشاء الحساب بنجاح',
      ...result,
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findOneByEmail(dto.email);
    if (!user || !(await argon2.verify(user.password, dto.password))) {
      throw new ForbiddenException(
        'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      );
    }

    const tokens = await this.getTokens(user.id);

    return {
      userId: user.id,
      email: user.email,
      tenantId: user.tenantId,
      isSuperAdmin: user.isSuperAdmin,
      isSystemAdmin: user.isSystemAdmin,
      ...tokens,
    };
  }

  async refreshTokens(userId: string, refreshToken: string) {
    const user = await this.usersService.findOne(userId);
    if (!user) throw new ForbiddenException('Access Denied');

    return this.getTokens(user.id);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.usersService.findOneByEmail(dto.email);

    if (!user) {
      return { message: 'إذا كان البريد مسجلاً، ستصلك تعليمات إعادة التعيين' };
    }

    const resetToken = this.jwtService.sign(
      { sub: user.id, type: 'reset' },
      {
        secret: process.env.JWT_RESET_SECRET || 'reset-secret-key',
        expiresIn: '1h',
      },
    );

    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
    console.log(`Reset Link for ${user.email}: ${resetLink}`);

    return { message: 'إذا كان البريد مسجلاً، ستصلك تعليمات إعادة التعيين' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    try {
      const payload = this.jwtService.verify<ResetTokenPayload>(dto.token, {
        secret: process.env.JWT_RESET_SECRET || 'reset-secret-key',
      });

      if (payload.type !== 'reset') {
        throw new ForbiddenException('توكن غير صالح');
      }

      const user = await this.usersService.findOne(payload.sub);
      const hashedPassword = await argon2.hash(dto.newPassword);

      await this.entityManager.transaction(async (manager) => {
        await manager.update(User, user.id, { password: hashedPassword });
      });

      return { message: 'تم تغيير كلمة المرور بنجاح' };
    } catch {
      throw new ForbiddenException(
        'رابط إعادة التعيين غير صالح أو منتهي الصلاحية',
      );
    }
  }

  private async getTokens(userId: string) {
    const user = await this.usersService.findOne(userId);

    const rolePayload = user.role
      ? {
          id: user.role.id,
          name: user.role.name,
          scope: user.role.scope,
          permissions:
            user.role.permissions?.map((p) => ({
              name: p.name,
              scope: p.scope,
              tenantId: p.tenantId,
            })) || [],
        }
      : undefined;

    const jwtPayload = {
      sub: userId,
      tenantId: user.tenantId,
      isSuperAdmin: user.isSuperAdmin,
      isSystemAdmin: user.isSystemAdmin,
      role: rolePayload,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(jwtPayload, {
        secret: process.env.JWT_ACCESS_SECRET || 'access-secret-key',
        expiresIn: '15m',
      }),
      this.jwtService.signAsync(jwtPayload, {
        secret: process.env.JWT_REFRESH_SECRET || 'refresh-secret-key',
        expiresIn: '7d',
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
