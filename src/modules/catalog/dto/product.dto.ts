// src/modules/catalog/dto/product.dto.ts
import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
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
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { ProductType } from '../entities/product.entity';

/** الباركود: أرقام/حروف وشرطات فقط (بلا مسافات) حتى يطابق ما يرسله القارئ */
const BARCODE_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;

export class ProductBarcodeDto {
  @IsString()
  @Matches(BARCODE_PATTERN, {
    message: 'الباركود يجب أن يكون من 3 إلى 64 حرفاً/رقماً بدون مسافات',
  })
  barcode!: string;

  /** الوحدة التي يبيعها هذا الباركود (اختياري — الافتراضي وحدة الأساس) */
  @IsOptional()
  @IsUUID()
  unitId?: string | null;
}

export class ProductUnitDto {
  @IsUUID()
  unitId!: string;

  /** كم وحدة أساس تساوي هذه الوحدة (الكرتون = 24) */
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001, { message: 'معامل التحويل يجب أن يكون أكبر من صفر' })
  factor!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  salePrice?: number | null;
}

export class CreateProductDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الصنف مطلوب' })
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameEn?: string;

  /** إذا تُرك فارغاً يُولَّد تلقائياً */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,40}$/, {
    message: 'كود الصنف: حروف إنجليزية وأرقام وشرطات فقط',
  })
  sku?: string;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsUUID(undefined, { message: 'وحدة الأساس مطلوبة' })
  baseUnitId!: string;

  /** إذا تُركت تُستخدم الضريبة الافتراضية للشركة */
  @IsOptional()
  @IsUUID()
  taxRateId?: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0, { message: 'سعر البيع لا يقل عن صفر' })
  salePrice!: number;

  @IsOptional()
  @IsBoolean()
  priceIncludesTax?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  minSalePrice?: number | null;

  @IsOptional()
  @IsBoolean()
  allowDiscount?: boolean;

  @IsOptional()
  @IsBoolean()
  isWeighted?: boolean;

  /** سعر مفتوح: يُكتب على شاشة الكاشير عند البيع */
  @IsOptional()
  @IsBoolean()
  openPrice?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  imagePath?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProductBarcodeDto)
  barcodes?: ProductBarcodeDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProductUnitDto)
  units?: ProductUnitDto[];
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class ProductQueryDto extends PaginationQueryDto {
  /** بحث بالاسم أو كود الصنف أو الباركود */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;
}
