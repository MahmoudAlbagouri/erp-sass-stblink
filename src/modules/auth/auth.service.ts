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

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mailerService: MailerService,
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

    // دائماً أعد نفس الرسالة لمنع هجوم User Enumeration
    if (!user) {
      return { message: 'إذا كان البريد مسجلاً، ستصلك تعليمات إعادة التعيين' };
    }

    // 1. توليد رمز عشوائي مكون من 12 رقم
    // Math.random() * 900000000000 يعطي رقماً حتى 12 خانة، نضيف 100000000000 لضمان أن الرقم يبدأ بـ 1 على الأقل (أي يبقى 12 خانة)
    const resetCode = Math.floor(
      100000000000 + Math.random() * 900000000000,
    ).toString();

    // 2. تشفير الرمز قبل الحفظ (أمان عالي)
    const hashedCode = await argon2.hash(resetCode);

    // 3. صلاحية الرمز (مثلاً 15 دقيقة)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    // 4. حفظ الرمز المشفر وتاريخ الانتهاء في قاعدة البيانات
    await this.entityManager.update(User, user.id, {
      resetPasswordToken: hashedCode,
      resetPasswordExpires: expiresAt,
    });

    // 5. إرسال الرمز عبر البريد الإلكتروني
    try {
      await this.mailerService.sendMail({
        to: dto.email,
        subject: 'رمز استعادة كلمة المرور - Ecommerce API',
        html: `
          <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #333;">استعادة كلمة المرور</h2>
            <p>مرحباً بك،</p>
            <p>لقد طلبت إعادة تعيين كلمة المرور. استخدم الرمز التالي لإتمام العملية:</p>
            <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0; text-align: center;">
              <h1 style="letter-spacing: 5px; color: #2c3e50; margin: 0;">${resetCode}</h1>
            </div>
            <p style="color: #666; font-size: 14px;">هذا الرمز صالح لمدة 15 دقيقة فقط.</p>
            <p style="color: #666; font-size: 14px;">إذا لم تطلب هذا الإجراء، يرجى تجاهل هذه الرسالة.</p>
          </div>
        `,
      });
    } catch (error) {
      console.error('Failed to send reset email:', error);
      // لا نفشل الطلب إذا فشل الإرسال للحفاظ على تجربة المستخدم، لكن نسجل الخطأ
    }

    return { message: 'إذا كان البريد مسجلاً، ستصلك تعليمات إعادة التعيين' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.usersService.findOneByEmail(dto.email);

    // 1. التحقق الأساسي من وجود بيانات الاستعادة
    if (!user || !user.resetPasswordToken || !user.resetPasswordExpires) {
      throw new BadRequestException('رمز التحقق غير صالح أو انتهت صلاحيته');
    }

    // 2. التحقق من الوقت
    if (new Date() > user.resetPasswordExpires) {
      throw new BadRequestException(
        'انتهت صلاحية رمز التحقق، يرجى طلب رمز جديد',
      );
    }

    // 3. تنظيف الكود المدخل (إزالة أي مسافات زائدة)
    const inputCode = dto.code.trim();

    // 4. التحقق من صحة الرمز باستخدام argon2
    // ملاحظة: argon2.verify(hash, plainText)
    let isCodeValid = false;
    try {
      isCodeValid = await argon2.verify(user.resetPasswordToken, inputCode);
    } catch (err) {
      console.error('Argon2 Verification Error:', err);
      throw new BadRequestException('حدث خطأ أثناء التحقق من الرمز');
    }

    if (!isCodeValid) {
      // للمساعدة في التصحيح (يمكنك حذف هذا السطر لاحقاً)
      console.log('Verification Failed. Stored Hash:', user.resetPasswordToken);
      console.log('Input Code:', inputCode);

      throw new BadRequestException('رمز التحقق غير صحيح');
    }

    // 5. تحديث كلمة المرور وحذف الرمز في معاملة واحدة
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
