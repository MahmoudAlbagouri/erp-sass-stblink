// src/modules/inventory/dto/inventory.dto.ts
import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  NotEquals,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { StockMovementType } from '../entities/stock-movement.entity';
import { StockTransferStatus } from '../entities/stock-transfer.entity';
import { StocktakeStatus } from '../entities/stocktake.entity';

/** أقصى عدد أسطر في مستند واحد (تحويل / جرد / تسوية) */
const MAX_LINES = 500;

// ══════════════════════════ المخازن ══════════════════════════

export class CreateWarehouseDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم المخزن مطلوب' })
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

  @IsOptional()
  @IsBoolean()
  allowNegativeStock?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** الفرع الذي يتبعه المخزن — يُترك فارغاً للفرع الرئيسي */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class UpdateWarehouseDto extends PartialType(CreateWarehouseDto) {}

// ══════════════════════════ الأرصدة والحركات ══════════════════════════

export class StockQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  /** بحث باسم الصنف أو كوده */
  @IsOptional()
  @IsString()
  search?: string;

  /** low = تحت حد إعادة الطلب، negative = رصيد سالب */
  @IsOptional()
  @IsIn(['low', 'negative'])
  alert?: 'low' | 'negative';
}

export class MovementQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsEnum(StockMovementType)
  type?: StockMovementType;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class SetMinQuantityDto {
  @IsUUID()
  warehouseId!: string;

  @IsUUID()
  productId!: string;

  /** null = إلغاء حد إعادة الطلب */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  minQuantity?: number | null;
}

export class AdjustmentLineDto {
  @IsUUID()
  productId!: string;

  /** موجبة = زيادة، سالبة = نقص (بوحدة الأساس) */
  @IsNumber({ maxDecimalPlaces: 4 })
  @NotEquals(0, { message: 'الكمية لا يمكن أن تكون صفراً' })
  quantity!: number;

  /** تكلفة الوحدة للكميات الداخلة — تدخل في متوسط التكلفة */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitCost?: number;
}

export class CreateAdjustmentDto {
  @IsUUID()
  warehouseId!: string;

  /** opening = رصيد افتتاحي (دخول فقط)، adjustment = تسوية يدوية */
  @IsIn([StockMovementType.OPENING, StockMovementType.ADJUSTMENT])
  type!: StockMovementType.OPENING | StockMovementType.ADJUSTMENT;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'أضف صنفاً واحداً على الأقل' })
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => AdjustmentLineDto)
  lines!: AdjustmentLineDto[];
}

// ══════════════════════════ التحويلات ══════════════════════════

export class TransferLineDto {
  @IsUUID()
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001, { message: 'الكمية يجب أن تكون أكبر من صفر' })
  quantity!: number;
}

export class CreateTransferDto {
  @IsUUID()
  fromWarehouseId!: string;

  @IsUUID()
  toWarehouseId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'أضف صنفاً واحداً على الأقل' })
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => TransferLineDto)
  lines!: TransferLineDto[];
}

export class UpdateTransferDto extends PartialType(CreateTransferDto) {}

export class ReceiveLineDto {
  @IsUUID()
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  receivedQuantity!: number;
}

export class ReceiveTransferDto {
  /** الأصناف التي استُلمت بكمية مختلفة عن المرسلة. غير المذكور = استُلم كاملاً */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => ReceiveLineDto)
  lines?: ReceiveLineDto[];
}

export class TransferQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(StockTransferStatus)
  status?: StockTransferStatus;

  /** تحويلات المخزن (مرسِلاً أو مستلِماً) */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}

// ══════════════════════════ الجرد ══════════════════════════

export class StocktakeLineDto {
  @IsUUID()
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0, { message: 'الكمية المعدودة لا تقل عن صفر' })
  countedQuantity!: number;
}

export class CreateStocktakeDto {
  @IsUUID()
  warehouseId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'أضف صنفاً واحداً على الأقل' })
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => StocktakeLineDto)
  lines!: StocktakeLineDto[];
}

export class UpdateStocktakeDto extends PartialType(CreateStocktakeDto) {}

export class StocktakeQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(StocktakeStatus)
  status?: StocktakeStatus;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
