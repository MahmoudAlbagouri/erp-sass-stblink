// src/modules/inventory/dto/import-stock.dto.ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  ImportProductItemDto,
  MAX_IMPORT_ITEMS,
} from '../../catalog/dto/import-products.dto';

export class ImportStockItemDto extends ImportProductItemDto {
  /** الرصيد الافتتاحي لهذا الصنف. بدونه تُستخدم `quantity` العامة */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  quantity?: number;

  /** تكلفة الوحدة. بدونها: سعر البيع × costRatio (إن حُدّدت) */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitCost?: number;
}

/** استيراد أصناف مع رصيدها الافتتاحي في طلب واحد */
export class ImportProductsWithStockDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  defaultUnit?: string;

  @IsOptional()
  @IsBoolean()
  priceIncludesTax?: boolean;

  @IsOptional()
  @IsUUID()
  taxRateId?: string;

  /** المخزن الذي يدخله الرصيد. بدونه: المخزن الرئيسي */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  /** الرصيد الافتتاحي لكل صنف لم تُحدَّد كميته (الافتراضي 0 = بلا رصيد) */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  quantity?: number;

  /**
   * تكلفة الوحدة كنسبة من سعر البيع (0.8 = 80%) للأصناف التي لم تُحدَّد
   * تكلفتها. بدونها يدخل الرصيد بلا تكلفة (قيمة المخزون صفر).
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  costRatio?: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'أضف صنفاً واحداً على الأقل' })
  @ArrayMaxSize(MAX_IMPORT_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => ImportStockItemDto)
  items!: ImportStockItemDto[];
}
