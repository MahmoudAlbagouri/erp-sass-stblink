// src/modules/auth/dto/reset-password.dto.ts
import { IsEmail, IsString, Length, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail({}, { message: 'يرجى إدخال بريد إلكتروني صحيح' })
  email: string;

  @IsString()
  @Length(12, 12, { message: 'يجب أن يكون رمز التحقق مكوناً من 12 رقماً' })
  code: string;

  @IsString()
  @MinLength(8, { message: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل' })
  newPassword: string;
}
