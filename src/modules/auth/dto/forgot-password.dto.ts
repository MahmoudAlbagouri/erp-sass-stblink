// src/modules/auth/dto/forgot-password.dto.ts
import { IsEmail, IsNotEmpty } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  @IsNotEmpty({ message: 'البريد الإلكتروني مطلوب' })
  email!: string;
}
