import {
  IsString,
  IsNotEmpty,
  IsEmail,
  MinLength,
  IsOptional,
  IsIn,
} from 'class-validator';
import { COUNTRY_CODES } from '../../../common/constants/countries';

export class RegisterDto {
  // --- بيانات الشركة ---
  @IsString()
  @IsNotEmpty({ message: 'اسم الشركة مطلوب' })
  companyName!: string;

  /** رمز الدولة ISO: منه تُحدَّد عملة الشركة ومفتاح الهاتف والمنطقة الزمنية */
  @IsIn(COUNTRY_CODES, { message: 'يرجى اختيار دولة مدعومة' })
  country!: string;

  /** محلي أو دولي: يُوحَّد إلى E.164 حسب الدولة */
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
