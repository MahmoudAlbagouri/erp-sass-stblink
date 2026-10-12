// src/modules/catalog/dto/catalog-settings.dto.ts
// DTOs لإعدادات الأصناف: التصنيفات، الوحدات، الضرائب.
import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsEnum,
  IsHexColor,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TaxCategory } from '../entities/tax-rate.entity';

// ─── التصنيفات ────────────────────────────────────────────────────────────────
export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم التصنيف مطلوب' })
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nameEn?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsHexColor({ message: 'اللون يجب أن يكون بصيغة hex' })
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

// ─── الوحدات ──────────────────────────────────────────────────────────────────
export class CreateUnitDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الوحدة مطلوب' })
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  symbol?: string;

  @IsOptional()
  @IsBoolean()
  allowsFractions?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateUnitDto extends PartialType(CreateUnitDto) {}

// ─── الضرائب ──────────────────────────────────────────────────────────────────
export class CreateTaxRateDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الضريبة مطلوب' })
  @MaxLength(120)
  name!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'نسبة الضريبة لا تقل عن صفر' })
  @Max(100, { message: 'نسبة الضريبة لا تتجاوز 100' })
  rate!: number;

  @IsOptional()
  @IsEnum(TaxCategory)
  category?: TaxCategory;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTaxRateDto extends PartialType(CreateTaxRateDto) {}
