// src/modules/employees/dto/create-employee.dto.ts
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsDateString,
  IsUUID,
  ValidateIf,
  Length, // ✅ استيراد Length
  Matches, // ✅ استيراد Matches للتحقق من الأرقام فقط
} from 'class-validator';
import { NationalityType } from '../entities/employee.entity';

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty({ message: 'الاسم الكامل مطلوب' })
  fullName!: string;

  @IsString()
  @IsOptional()
  employeeCode?: string;

  @IsEnum(NationalityType)
  @IsNotEmpty({ message: 'نوع الجنسية مطلوب' })
  nationalityType!: NationalityType;

  @ValidateIf(
    (o: CreateEmployeeDto) => o.nationalityType === NationalityType.NON_SAUDI,
  )
  @IsDateString({}, { message: 'تاريخ انتهاء الإقامة مطلوب لغير السعوديين' })
  iqamaExpiryDate?: string;

  // ✅ تحديث رقم الهوية: يجب أن يكون 10 أرقام بالضبط
  @IsString()
  @IsOptional()
  @Length(10, 10, { message: 'رقم الهوية يجب أن يتكون من 10 أرقام' })
  @Matches(/^[0-9]{10}$/, { message: 'رقم الهوية يجب أن يحتوي على أرقام فقط' })
  nationalId?: string;

  @IsString()
  @IsOptional()
  nationalIdCardPath?: string;

  // ✅ تحديث رقم الهاتف: يجب أن يكون 10 أرقام بالضبط
  @IsString()
  @IsOptional()
  @Length(10, 10, { message: 'رقم الهاتف يجب أن يتكون من 10 أرقام' })
  @Matches(/^[0-9]{10}$/, { message: 'رقم الهاتف يجب أن يحتوي على أرقام فقط' })
  phone?: string;

  @IsUUID()
  @IsOptional()
  shiftId?: string;

  @IsString()
  @IsOptional()
  jobTitle?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsEnum(['active', 'inactive', 'terminated'])
  @IsOptional()
  status?: 'active' | 'inactive' | 'terminated';

  @IsString()
  @IsOptional()
  userId?: string;
}
