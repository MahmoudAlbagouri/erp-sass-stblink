// src/modules/catalog/dto/import-products.dto.ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** أقصى عدد أصناف في طلب استيراد واحد */
export const MAX_IMPORT_ITEMS = 1000;

export class ImportProductItemDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الصنف مطلوب' })
  @MaxLength(200)
  name!: string;

  /** اسم التصنيف — يُنشأ إن لم يكن موجوداً */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  /** اسم وحدة الأساس — تُنشأ إن لم تكن موجودة. بدونها تُستخدم defaultUnit */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  unit?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0, { message: 'سعر البيع لا يقل عن صفر' })
  salePrice!: number;

  /** إذا تُرك يُولَّد تلقائياً */
  @IsOptional()
  @Matches(/^[A-Za-z0-9._-]{1,40}$/, {
    message: 'كود الصنف: حروف إنجليزية وأرقام وشرطات فقط',
  })
  sku?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._-]{3,64}$/, {
    message: 'الباركود يجب أن يكون من 3 إلى 64 حرفاً/رقماً بدون مسافات',
  })
  barcode?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  minSalePrice?: number;
}

export class ImportProductsDto {
  /** وحدة الأصناف التي لم تُحدَّد وحدتها (الافتراضي: قطعة) */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  defaultUnit?: string;

  /** الأسعار شاملة الضريبة (الافتراضي: نعم) */
  @IsOptional()
  @IsBoolean()
  priceIncludesTax?: boolean;

  /** ضريبة كل الأصناف. بدونها تُستخدم الضريبة الافتراضية للشركة */
  @IsOptional()
  @IsUUID()
  taxRateId?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'أضف صنفاً واحداً على الأقل' })
  @ArrayMaxSize(MAX_IMPORT_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ImportProductItemDto)
  items!: ImportProductItemDto[];
}
