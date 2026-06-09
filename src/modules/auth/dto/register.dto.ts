import {
  IsString,
  IsNotEmpty,
  IsEmail,
  MinLength,
  IsOptional,
} from 'class-validator';

export class RegisterDto {
  // --- بيانات الشركة ---
  @IsString()
  @IsNotEmpty({ message: 'اسم الشركة مطلوب' })
  companyName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  // --- بيانات المدير الأول (Admin) ---
  @IsString()
  @IsNotEmpty({ message: 'اسم المستخدم مطلوب' })
  username!: string;

  @IsEmail({}, { message: 'البريد الإلكتروني غير صالح' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة' })
  @MinLength(6, { message: 'كلمة المرور يجب أن لا تقل عن 6 أحرف' })
  password!: string;
}
