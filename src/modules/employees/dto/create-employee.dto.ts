// src/modules/employees/dto/create-employee.dto.ts
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsDateString,
} from 'class-validator';

export class CreateEmployeeDto {
  @IsString()
  @IsNotEmpty({ message: 'الاسم الكامل مطلوب' })
  fullName!: string;

  @IsString()
  @IsNotEmpty({ message: 'الرقم الوظيفي مطلوب' })
  employeeCode!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  jobTitle?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsDateString()
  @IsOptional()
  hireDate?: string;

  @IsEnum(['active', 'inactive', 'terminated'])
  @IsOptional()
  status?: 'active' | 'inactive' | 'terminated';

  // ✅ ID المستخدم المرتبط (اختياري)
  @IsString()
  @IsOptional()
  userId?: string;
}
