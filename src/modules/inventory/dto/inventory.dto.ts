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
  Matches,
  MaxLength,
  Min,
  NotEquals,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  StockAdjustmentReason,
  StockMovementType,
} from '../entities/stock-movement.entity';
import { StockTransferStatus } from '../entities/stock-transfer.entity';
import { StocktakeStatus } from '../entities/stocktake.entity';

/** أقصى عدد أسطر في مستند واحد (تحويل / جرد / تسوية) */
export const MAX_LINES = 500;
/** تاريخ بلا وقت: 2026-10-12 */
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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

  /** سبب التسوية (تالف، منتهي، هالك...) */
  @IsOptional()
  @IsEnum(StockAdjustmentReason)
  reason?: StockAdjustmentReason;

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

  // ─── الدفعات (لصنف يتتبع دفعاته؛ تُهمل لغيره) ───
  /** دفعة الكمية الداخلة (تُنشأ إن لم توجد). غيابها = رصيد غير معيّن */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  lotNumber?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD' })
  expiryDate?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD' })
  manufactureDate?: string;

  /** الدفعة التي تخرج منها الكمية الناقصة. غيابها = الأقرب انتهاءً */
  @IsOptional()
  @IsUUID()
  lotId?: string;
}

export class CreateAdjustmentDto {
  @IsUUID()
  warehouseId!: string;

  /** opening = رصيد افتتاحي (دخول فقط)، adjustment = تسوية يدوية */
  @IsIn([StockMovementType.OPENING, StockMovementType.ADJUSTMENT])
  type!: StockMovementType.OPENING | StockMovementType.ADJUSTMENT;

  /**
   * سبب التسوية (للتسوية فقط، لا للرصيد الافتتاحي). اختياري للتوافق مع
   * الأجهزة القديمة، والشاشات تطلبه: منه يُحلَّل الهالك والفاقد.
   */
  @IsOptional()
  @IsEnum(StockAdjustmentReason, { message: 'سبب التسوية غير معروف' })
  reason?: StockAdjustmentReason;

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

  /** قد تبدأ فارغة وتُعدّ من شاشة العدّ؛ الاعتماد يحتاج صنفاً واحداً على الأقل */
  @IsArray()
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => StocktakeLineDto)
  lines!: StocktakeLineDto[];
}

export class UpdateStocktakeDto extends PartialType(CreateStocktakeDto) {
  /**
   * `updatedAt` كما فتحته الشاشة. إن تغيّر الجرد بعدها (عُدّ من شاشة العدّ أو
   * عدّله غيرك) يُرفض الحفظ بـ 409 بدل أن يمسح ما عُدّ.
   */
  @IsOptional()
  @IsDateString()
  expectedUpdatedAt?: string;
}

/** عدّ صنف واحد من شاشة العدّ */
export class StocktakeCountDto {
  @IsUUID()
  productId!: string;

  /** الكمية المعدودة بوحدة الأساس. null = أُزيل الصنف من الجرد */
  @ValidateIf((count: StocktakeCountDto) => count.countedQuantity !== null)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0, { message: 'الكمية المعدودة لا تقل عن صفر' })
  countedQuantity!: number | null;

  /** متى عُدّ على الجهاز: الأحدث يكسب إن عدّ الصنف جهازان */
  @IsDateString()
  countedAt!: string;
}

export class StocktakeCountsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => StocktakeCountDto)
  counts!: StocktakeCountDto[];
}

export class StocktakeQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(StocktakeStatus)
  status?: StocktakeStatus;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;
}
