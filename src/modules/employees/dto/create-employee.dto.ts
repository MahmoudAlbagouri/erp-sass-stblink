// src/modules/employees/dto/create-employee.dto.ts
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsDateString,
  IsUUID,
  ValidateIf,
  Length,
  Matches,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { NationalityType } from '../entities/employee.entity';
import { EducationDto } from './education.dto';
import { Type } from 'class-transformer';

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

  @ValidateNested({ each: true })
  @Type(() => EducationDto)
  @IsArray()
  @IsOptional()
  educations?: EducationDto[];

  @ValidateIf(
    (o: CreateEmployeeDto) => o.nationalityType === NationalityType.NON_SAUDI,
  )
  @IsDateString({}, { message: 'تاريخ انتهاء الإقامة مطلوب لغير السعوديين' })
  iqamaExpiryDate?: string;

  @IsString()
  @IsOptional()
  @Length(10, 10, { message: 'رقم الهوية يجب أن يتكون من 10 أرقام' })
  @Matches(/^[0-9]{10}$/, { message: 'رقم الهوية يجب أن يحتوي على أرقام فقط' })
  nationalId?: string;

  @IsString()
  @IsOptional()
  nationalIdCardPath?: string;

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

  // ✅ department أصبح departmentId (UUID) بدل نص حر
  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsEnum(['active', 'inactive', 'terminated'])
  @IsOptional()
  status?: 'active' | 'inactive' | 'terminated';

  @IsString()
  @IsOptional()
  userId?: string;
}
