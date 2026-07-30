// src/modules/auth/auth.service.ts
import {
  Injectable,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import * as argon2 from 'argon2';
import { MailerService } from '@nestjs-modules/mailer';
import { UsersService } from '../users/users.service';
import { TenantsService } from '../tenants/tenants.service';
import { SubscriptionManagerService } from '../subscriptions/subscription-manager.service';
import { Subscription } from '../subscriptions/entities/subscription.entity'; // ✅ استيراد Entity الاشتراك
import { User } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UserStatus } from '../../common/enums/user.enums';
import { SubscriptionStatus } from '../../common/enums/subscription.enums'; // ✅ استيراد Enum الحالات

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tenantsService: TenantsService,
    private readonly subscriptionManager: SubscriptionManagerService,
    private readonly jwtService: JwtService,
    private readonly mailerService: MailerService,
    @InjectEntityManager() private readonly entityManager: EntityManager,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.usersService.findOneByEmail(dto.email);
    if (existingUser)
      throw new ConflictException('البريد الإلكتروني مستخدم بالفعل');

    let createdUser!: User;

    await this.entityManager.transaction(async (manager: EntityManager) => {
      const tenant = await this.tenantsService.create(
        {
          companyName: String(dto.companyName),
          phone: dto.phone,
          address: dto.address,
          language: 'ar',
          timezone: 'UTC+3',
        },
        manager,
      );

      const hashedPassword = await argon2.hash(dto.password);
      const admin = manager.create(User, {
        username: dto.username,
        email: dto.email,
        password: hashedPassword,
        tenantId: tenant.id,
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

    if (
      !user ||
      !user.password ||
      !(await argon2.verify(user.password, dto.password))
    ) {
      throw new ForbiddenException(
        'البريد الإلكتروني أو كلمة المرور غير صحيحة',
      );
    }

    // ✅ التحقق الدقيق من حالة الاشتراك وعرض رسالة مخصصة
    if (!user.isSystemAdmin && user.tenantId) {
      try {
        // جلب آخر اشتراك للشركة لمعرفة حالته الدقيقة
        const subRepo = this.entityManager.getRepository(Subscription);
        const subscription = await subRepo.findOne({
          where: { tenantId: user.tenantId },
          order: { created_at: 'DESC' },
        });

        if (!subscription) {
          throw new ForbiddenException(
            'لا يوجد اشتراك مسجل لهذه الشركة. يرجى التواصل مع الإدارة.',
          );
        }

        // منع الدخول بناءً على الحالة المحددة برسائل واضحة
        switch (subscription.status) {
          case SubscriptionStatus.CANCELLED:
            throw new ForbiddenException(
              'عذراً، حساب شركتكم ملغي نهائياً. لا يمكن تسجيل الدخول.',
            );

          case SubscriptionStatus.SUSPENDED:
            throw new ForbiddenException(
              'حساب شركتكم معلق حالياً. يرجى التواصل مع الإدارة لحل المشكلة.',
            );

          case SubscriptionStatus.PENDING:
            throw new ForbiddenException(
              'اشتراك شركتكم قيد المراجعة/الانتظار. يرجى الانتظار حتى يتم التفعيل.',
            );

          case SubscriptionStatus.EXPIRED:
            throw new ForbiddenException(
              'انتهت صلاحية اشتراك شركتكم. يرجى التجديد للمتابعة.',
            );
        }

        // إذا وصلنا هنا، فالحالة إما ACTIVE أو TRIAL، ونسمح بالدخول
      } catch (error) {
        // إعادة رمي الخطأ إذا كان ForbiddenException، وإلا نعتبره خطأ تقني
        if (error instanceof ForbiddenException) {
          throw error;
        }
        throw new ForbiddenException('حدث خطأ أثناء التحقق من حالة الاشتراك.');
      }
    }

    return { userId: user.id, ...(await this.getTokens(user.id)) };
  }

  async refreshTokens(userId: string) {
    const user = await this.usersService.findOne(userId);
    if (!user) throw new ForbiddenException('User not found');
    return this.getTokens(user.id);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.usersService.findOneByEmail(dto.email);
    if (!user) {
      return { message: 'إذا كان البريد مسجلاً، ستصلك تعليمات إعادة التعيين' };
    }

    const resetCode = Math.floor(
      100000000000 + Math.random() * 900000000000,
    ).toString();
    const hashedCode = await argon2.hash(resetCode);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.entityManager.update(User, user.id, {
      resetPasswordToken: hashedCode,
      resetPasswordExpires: expiresAt,
    });

    try {
      await this.mailerService.sendMail({
        to: dto.email,
        subject: 'رمز استعادة كلمة المرور - ERP System',
        html: `
          <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #333;">استعادة كلمة المرور</h2>
            <p>مرحباً بك،</p>
            <p>لقد طلبت إعادة تعيين كلمة المرور. استخدم الرمز التالي لإتمام العملية:</p>
            <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: center;">
              <h1 style="letter-spacing: 5px; color: #2c3e50; margin: 0;">${resetCode}</h1>
            </div>
            <p style="color: #666; font-size: 14px;">هذا الرمز صالح لمدة 15 دقيقة فقط.</p>
          </div>
        `,
      });
    } catch (error) {
      console.error('Failed to send reset email:', error);
    }

    return { message: 'إذا كان البريد مسجلاً، ستصلك تعليمات إعادة التعيين' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.usersService.findOneByEmail(dto.email);
    if (!user || !user.resetPasswordToken || !user.resetPasswordExpires) {
      throw new BadRequestException('رمز التحقق غير صالح أو انتهت صلاحيته');
    }

    if (new Date() > user.resetPasswordExpires) {
      throw new BadRequestException(
        'انتهت صلاحية رمز التحقق، يرجى طلب رمز جديد',
      );
    }

    const inputCode = dto.code.trim();
    let isCodeValid = false;
    try {
      isCodeValid = await argon2.verify(user.resetPasswordToken, inputCode);
    } catch {
      throw new BadRequestException('حدث خطأ أثناء التحقق من الرمز');
    }

    if (!isCodeValid) {
      throw new BadRequestException('رمز التحقق غير صحيح');
    }

    await this.entityManager.transaction(async (manager) => {
      const hashedPassword = await argon2.hash(dto.newPassword);
      await manager.update(User, user.id, {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      });
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
