// src/modules/branches/dto/branch.dto.ts
import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الفرع مطلوب' })
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  /** موقع الفرع: تُقاس به بصمة الجوال */
  @IsOptional()
  @IsNumber({}, { message: 'خط العرض غير صالح' })
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @IsOptional()
  @IsNumber({}, { message: 'خط الطول غير صالح' })
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  /** نصف قطر نطاق البصمة بالمتر */
  @IsOptional()
  @IsInt({ message: 'نطاق البصمة يجب أن يكون رقماً صحيحاً' })
  @Min(30, { message: 'أقل نطاق للبصمة 30 متراً' })
  @Max(5000, { message: 'أقصى نطاق للبصمة 5000 متر' })
  punchRadiusMeters?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBranchDto extends PartialType(CreateBranchDto) {}
