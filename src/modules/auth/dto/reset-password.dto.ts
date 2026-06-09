// src/modules/auth/dto/reset-password.dto.ts
import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'التوكن مطلوب' })
  token!: string; // التوكن المستلم عبر الإيميل

  @IsString()
  @IsNotEmpty({ message: 'كلمة المرور الجديدة مطلوبة' })
  @MinLength(6, { message: 'كلمة المرور يجب أن لا تقل عن 6 أحرف' })
  newPassword!: string;
}
