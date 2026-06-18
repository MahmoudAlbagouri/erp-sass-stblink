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

interface JwtPayload {
  sub: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    @InjectEntityManager() private readonly entityManager: EntityManager,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.usersService.findOneByEmail(dto.email);
    if (existingUser)
      throw new ConflictException('البريد الإلكتروني مستخدم بالفعل');

    let createdUser!: User;
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
      });
      const savedTenant = await manager.save(tenant);
      const hashedPassword = await argon2.hash(dto.password);
      const admin = manager.create(User, {
        username: dto.username,
        email: dto.email,
        password: hashedPassword,
        tenantId: savedTenant.id,
        isSuperAdmin: true,
        status: UserStatus.ACTIVE,
      });
      createdUser = await manager.save(admin);
    });

    return {
      message: 'تم إنشاء الحساب بنجاح',
      userId: createdUser.id,
      ...(await this.getTokens(createdUser.id)),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findOneByEmail(dto.email);

    // 1. التأكد من وجود المستخدم
    // 2. التأكد من أن المستخدم لديه كلمة مرور (ليست null أو string فارغ)
    // 3. التأكد من صحة كلمة المرور باستخدام argon2
    if (
      !user ||
      !user.password ||
      !(await argon2.verify(user.password, dto.password))
    ) {
      throw new ForbiddenException(
        'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      );
    }

    return { userId: user.id, ...(await this.getTokens(user.id)) };
  }

  async refreshTokens(userId: string) {
    // 1. جلب بيانات المستخدم من قاعدة البيانات مباشرة (لضمان آخر تحديث)
    const user = await this.usersService.findOne(userId);

    if (!user) throw new ForbiddenException('User not found');

    // 2. إعادة توليد التوكنز بناءً على حالة المستخدم الحالية في DB
    return this.getTokens(user.id);
  }
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.usersService.findOneByEmail(dto.email);
    if (user) console.log(`Reset link generated for: ${user.email}`);
    return { message: 'إذا كان البريد مسجلاً، ستصلك تعليمات إعادة التعيين' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const payload = this.jwtService.verify<JwtPayload>(dto.token, {
      secret: process.env.JWT_RESET_SECRET || 'reset-key',
    });
    const hashedPassword = await argon2.hash(dto.newPassword);
    await this.entityManager.update(User, payload.sub, {
      password: hashedPassword,
    });
    return { message: 'تم تغيير كلمة المرور بنجاح' };
  }

  private async getTokens(userId: string) {
    const user = await this.usersService.findOne(userId);
    const jwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      isSuperAdmin: user.isSuperAdmin,
      isSystemAdmin: user.isSystemAdmin,
      employeeId: user.employee?.id,
      role: user.role
        ? {
            id: user.role.id,
            name: user.role.name,
            permissions: user.role.permissions?.map((p) => ({ name: p.name })),
          }
        : null,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(jwtPayload, {
        secret: process.env.JWT_ACCESS_SECRET || 'access-key',
        expiresIn: '15m',
      }),
      this.jwtService.signAsync(jwtPayload, {
        secret: process.env.JWT_REFRESH_SECRET || 'refresh-key',
        expiresIn: '7d',
      }),
    ]);
    return { accessToken, refreshToken };
  }
}
