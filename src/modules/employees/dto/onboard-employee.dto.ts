// src/modules/employees/dto/onboard-employee.dto.ts
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsDateString,
  IsUUID,
  IsEmail,
  IsNumber,
  Min,
  ValidateIf,
  ValidateNested,
  IsArray,
  Length,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { NationalityType } from '../entities/employee.entity';
import { ContractType } from '../../contracts/entities/contract.entity';

export class OnboardUserDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم المستخدم مطلوب' })
  username!: string;

  @IsEmail({}, { message: 'بريد إلكتروني غير صالح' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة' })
  password!: string;

  @IsUUID()
  @IsOptional()
  roleId?: string;

  @IsString()
  @IsOptional()
  roleName?: string;

  @IsArray()
  @IsOptional()
  permissionIds?: string[];
}

export class OnboardContractDto {
  @IsEnum(ContractType)
  @IsNotEmpty()
  contractType!: ContractType;

  @IsDateString()
  @IsNotEmpty()
  startDate!: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsNumber()
  @IsOptional()
  annualLeaveDays?: number;

  // ✅ إضافة حقل مدة العقد
  @IsNumber()
  @IsOptional()
  @Min(1)
  contractDurationYears?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsOptional()
  attachmentPaths?: string[];
}

export class OnboardSalaryDto {
  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  basicSalary!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  housingAllowance?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  transportAllowance?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  otherAllowances?: number;
}

export class OnboardEmployeeDto {
  @IsString()
  @IsNotEmpty({ message: 'الاسم الكامل مطلوب' })
  fullName!: string;

  @IsEnum(NationalityType)
  @IsNotEmpty({ message: 'نوع الجنسية مطلوب' })
  nationalityType!: NationalityType;

  @ValidateIf(
    (o: OnboardEmployeeDto) => o.nationalityType === NationalityType.NON_SAUDI,
  )
  @IsDateString({}, { message: 'تاريخ انتهاء الإقامة مطلوب لغير السعوديين' })
  iqamaExpiryDate?: string;

  // ✅ تحديث رقم الهوية
  @IsString()
  @IsOptional()
  @Length(10, 10, { message: 'رقم الهوية يجب أن يتكون من 10 أرقام' })
  @Matches(/^[0-9]{10}$/, { message: 'رقم الهوية يجب أن يحتوي على أرقام فقط' })
  nationalId?: string;

  @IsString()
  @IsOptional()
  nationalIdCardPath?: string;

  // ✅ تحديث رقم الهاتف
  @IsString()
  @IsOptional()
  @Length(10, 10, { message: 'رقم الهاتف يجب أن يتكون من 10 أرقام' })
  @Matches(/^[0-9]{10}$/, { message: 'رقم الهاتف يجب أن يحتوي على أرقام فقط' })
  phone?: string;

  @IsString()
  @IsOptional()
  jobTitle?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsUUID()
  @IsOptional()
  shiftId?: string;

  @IsEnum(['active', 'inactive', 'terminated'])
  @IsOptional()
  status?: 'active' | 'inactive' | 'terminated';

  @ValidateNested()
  @Type(() => OnboardUserDto)
  @IsOptional()
  user?: OnboardUserDto;

  @ValidateNested()
  @Type(() => OnboardContractDto)
  @IsOptional()
  contract?: OnboardContractDto;

  @ValidateNested()
  @Type(() => OnboardSalaryDto)
  @IsOptional()
  salary?: OnboardSalaryDto;
}
