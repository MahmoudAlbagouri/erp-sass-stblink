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
} from 'class-validator';
import { Type } from 'class-transformer';
import { NationalityType } from '../entities/employee.entity';
import { ContractType } from '../../contracts/entities/contract.entity';

// ─── بيانات المستخدم المدمجة ──────────────────────────────────────────────
export class OnboardUserDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم المستخدم مطلوب' })
  username!: string;

  @IsEmail({}, { message: 'بريد إلكتروني غير صالح' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'كلمة المرور مطلوبة' })
  password!: string;

  // ✅ إما roleId لدور موجود، أو roleName لإنشاء دور جديد بصلاحيات افتراضية
  @IsUUID()
  @IsOptional()
  roleId?: string;

  // ✅ لو مش عايز تربط المستخدم بأي دور
  @IsString()
  @IsOptional()
  roleName?: string;

  @IsArray()
  @IsOptional()
  permissionIds?: string[];
}

// ─── بيانات العقد (اختيارية) ─────────────────────────────────────────────
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

  @IsString()
  @IsOptional()
  notes?: string;

  // ✅ استقبال مصفوفة مسارات مرفقات العقد
  @IsArray()
  @IsOptional()
  attachmentPaths?: string[];
}

// ─── بيانات الراتب (اختيارية) ────────────────────────────────────────────
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

// ─── DTO الرئيسي للـ Onboarding ──────────────────────────────────────────
export class OnboardEmployeeDto {
  // ═══ بيانات الموظف ════════════════════════════════════════════════════
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

  @IsString()
  @IsOptional()
  nationalId?: string;

  // ✅ مسار صورة/ملف الهوية الوطنية
  @IsString()
  @IsOptional()
  nationalIdCardPath?: string;

  @IsString()
  @IsOptional()
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

  // ═══ بيانات المستخدم (اختيارية — لو مش عايز تربط الموظف بحساب) ═════
  @ValidateNested()
  @Type(() => OnboardUserDto)
  @IsOptional()
  user?: OnboardUserDto;

  // ═══ بيانات العقد (اختيارية) ══════════════════════════════════════════
  @ValidateNested()
  @Type(() => OnboardContractDto)
  @IsOptional()
  contract?: OnboardContractDto;

  // ═══ بيانات الراتب (اختيارية) ════════════════════════════════════════
  @ValidateNested()
  @Type(() => OnboardSalaryDto)
  @IsOptional()
  salary?: OnboardSalaryDto;
}
