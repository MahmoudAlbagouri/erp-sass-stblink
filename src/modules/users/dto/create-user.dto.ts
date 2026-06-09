// src/modules/users/dto/create-user.dto.ts
import {
  IsString,
  IsNotEmpty,
  IsEmail,
  IsOptional,
  IsUUID,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { UserStatus } from '../../../common/enums/user.enums';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم المستخدم مطلوب' })
  username!: string;

  @IsEmail({}, { message: 'بريد إلكتروني غير صالح' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة' })
  password!: string;

  @IsOptional()
  @IsUUID()
  roleId?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsBoolean()
  isSuperAdmin?: boolean; // تحذير: يجب التحكم في هذا الحقل عبر Guards أو Logic وليس فقط Validation
}
