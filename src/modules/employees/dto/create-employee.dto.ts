// src/modules/employees/dto/create-employee.dto.ts
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsDateString,
  IsUUID,
  ValidateIf,
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
  // طول رقم الهوية يختلف من دولة لأخرى (السعودية 10، مصر 14…)
  @Matches(/^[0-9]{6,20}$/, {
    message: 'رقم الهوية يجب أن يتكون من 6 إلى 20 رقماً',
  })
  nationalId?: string;

  /** معرّف ملف صورة الهوية (من POST /files/employee)؛ null لإزالتها */
  @IsOptional()
  @IsUUID('4', { message: 'ملف الهوية غير صالح' })
  nationalIdCardFileId?: string | null;

  @IsString()
  @IsOptional()
  // دولي E.164 (+9665XXXXXXXX) أو محلي بالأرقام فقط: الطول يختلف من دولة لأخرى
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'رقم الهاتف غير صالح' })
  phone?: string;

  @IsUUID()
  @IsOptional()
  shiftId?: string;

  @IsString()
  @IsOptional()
  jobTitle?: string;

  /** الفرع الذي يعمل فيه الموظف — يُترك فارغاً للفرع الرئيسي */
  @IsUUID()
  @IsOptional()
  branchId?: string;

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
