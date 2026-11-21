// src/modules/manufacturing/dto/manufacturing.dto.ts
import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { BomKind } from '../entities/bom.entity';
import {
  DowntimeReason,
  ProductionOrderStatus,
  ProductionScrapReason,
  TimeLogKind,
} from '../entities/production-order.entity';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD';
const QTY = { maxDecimalPlaces: 4 };

// ══════════════════════════ مراكز العمل ══════════════════════════

export class CreateWorkCenterDto {
  /** فارغ = يُولَّد (WC-001) */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsString()
  @IsNotEmpty({ message: 'اسم مركز العمل مطلوب' })
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  /** ماكينات أو عمال متوازيون */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  parallelUnits?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.5)
  @Max(24)
  hoursPerDay?: number;

  /** 0 = الأحد … 6 = السبت */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingDays?: number[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(200)
  efficiencyPercent?: number;

  /** تكلفة الساعة (عمالة + تشغيل) */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  costPerHour?: number;

  /** المصاريف غير المباشرة لكل ساعة */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  overheadPerHour?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateWorkCenterDto extends PartialType(CreateWorkCenterDto) {}

// ══════════════════════════ قوائم المكوّنات ══════════════════════════

export class BomLineDto {
  @IsUUID()
  componentId!: string;

  /** الكمية لدفعة outputQuantity بوحدة أساس المكوّن */
  @IsNumber(QTY)
  @Min(0.0001, { message: 'كمية المكوّن أكبر من صفر' })
  quantity!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(500)
  scrapPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  operationSequence?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class BomOperationDto {
  @IsInt()
  @Min(0)
  sequence!: number;

  @IsString()
  @IsNotEmpty({ message: 'اسم الخطوة مطلوب' })
  @MaxLength(150)
  name!: string;

  @IsUUID(undefined, { message: 'مركز العمل مطلوب' })
  workCenterId!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  setupMinutes?: number;

  /** لدفعة outputQuantity */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  runMinutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  instructions?: string;
}

export class BomByproductDto {
  @IsUUID()
  productId!: string;

  @IsNumber(QTY)
  @Min(0.0001)
  quantity!: number;
}

export class CreateBomDto {
  /** production = منتج يدخل المخزون بأمر إنتاج، recipe = وصفة طبق تُخصم عند البيع */
  @IsEnum(BomKind)
  kind!: BomKind;

  @IsUUID(undefined, { message: 'المنتج مطلوب' })
  productId!: string;

  /** فارغ = اسم المنتج */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  /** كمية الدفعة التي كُتبت لها الأسطر (بوحدة أساس الناتج) */
  @IsOptional()
  @IsNumber(QTY)
  @Min(0.0001)
  outputQuantity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100)
  expectedYieldPercent?: number;

  /** وقت تجهيز الطبق بالدقائق (المطاعم) */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(1440)
  prepMinutes?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ArrayMinSize(1, { message: 'أضف مكوّناً واحداً على الأقل' })
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => BomLineDto)
  lines!: BomLineDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BomOperationDto)
  operations?: BomOperationDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => BomByproductDto)
  byproducts?: BomByproductDto[];
}

export class UpdateBomDto extends PartialType(CreateBomDto) {}

export class BomQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(BomKind)
  kind?: BomKind;

  @IsOptional()
  @IsUUID()
  productId?: string;

  /** باسم القائمة أو المنتج أو كوده */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;
}

// ══════════════════════════ أوامر الإنتاج ══════════════════════════

export class CreateProductionOrderDto {
  @IsUUID(undefined, { message: 'المنتج مطلوب' })
  productId!: string;

  /** فارغ = القائمة الافتراضية للمنتج */
  @IsOptional()
  @IsUUID()
  bomId?: string;

  @IsNumber(QTY)
  @Min(0.0001, { message: 'الكمية أكبر من صفر' })
  plannedQuantity!: number;

  /** مخزن الناتج */
  @IsUUID(undefined, { message: 'مخزن الناتج مطلوب' })
  warehouseId!: string;

  /** مخزن الخامات. فارغ = مخزن الناتج */
  @IsOptional()
  @IsUUID()
  materialsWarehouseId?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  plannedStartDate?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  plannedEndDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  outputLotNumber?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  outputExpiryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  note?: string;
}

export class UpdateProductionOrderDto extends PartialType(
  CreateProductionOrderDto,
) {}

export class ProductionOrderQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn([...Object.values(ProductionOrderStatus), 'open'])
  status?: ProductionOrderStatus | 'open';

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  workCenterId?: string;

  /** برقم الأمر أو المنتج أو المرجع */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  to?: string;
}

export class IssueLineDto {
  @IsUUID()
  productId!: string;

  @IsNumber(QTY)
  @Min(0.0001)
  quantity!: number;

  /** الدفعة المصروفة منها. فارغ = الأقرب انتهاءً */
  @IsOptional()
  @IsUUID()
  lotId?: string;
}

export class IssueMaterialsDto {
  /** فارغ = صرف المتبقي من كل الخامات المخططة */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => IssueLineDto)
  lines?: IssueLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ReturnLineDto {
  @IsUUID()
  productId!: string;

  @IsNumber(QTY)
  @Min(0.0001)
  quantity!: number;
}

export class ReturnMaterialsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class StartTimeLogDto {
  @IsUUID()
  operationId!: string;

  @IsEnum(TimeLogKind)
  kind!: TimeLogKind;

  /** للتوقف فقط */
  @ValidateIf((o: StartTimeLogDto) => o.kind === TimeLogKind.DOWNTIME)
  @IsEnum(DowntimeReason, { message: 'سبب التوقف مطلوب' })
  downtimeReason?: DowntimeReason;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  operatorName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class StopTimeLogDto {
  /** ما أُنجز جيداً خلال الفترة */
  @IsOptional()
  @IsNumber(QTY)
  @Min(0)
  quantity?: number;

  @IsOptional()
  @IsNumber(QTY)
  @Min(0)
  scrapQuantity?: number;

  @ValidateIf((o: StopTimeLogDto) => (o.scrapQuantity ?? 0) > 0)
  @IsEnum(ProductionScrapReason, { message: 'سبب الرفض مطلوب' })
  scrapReason?: ProductionScrapReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** فترة تُسجَّل بعد حدوثها (بدقائقها) لمن لا يضغط بدء/إيقاف */
export class ManualTimeLogDto extends StopTimeLogDto {
  @IsUUID()
  operationId!: string;

  @IsEnum(TimeLogKind)
  kind!: TimeLogKind;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100000)
  minutes!: number;

  /** وقت البداية الفعلي (ISO). فارغ = الآن ناقص الدقائق */
  @IsOptional()
  @IsString()
  startedAt?: string;

  @ValidateIf((o: ManualTimeLogDto) => o.kind === TimeLogKind.DOWNTIME)
  @IsEnum(DowntimeReason, { message: 'سبب التوقف مطلوب' })
  downtimeReason?: DowntimeReason;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  operatorName?: string;
}

export class ByproductOutputDto {
  @IsUUID()
  productId!: string;

  @IsNumber(QTY)
  @Min(0)
  quantity!: number;
}

export class ProductionOutputDto {
  /** الكمية الجيدة المستلمة الآن (بوحدة أساس المنتج) */
  @IsNumber(QTY)
  @Min(0)
  quantity!: number;

  @IsOptional()
  @IsNumber(QTY)
  @Min(0)
  scrapQuantity?: number;

  @ValidateIf((o: ProductionOutputDto) => (o.scrapQuantity ?? 0) > 0)
  @IsEnum(ProductionScrapReason, { message: 'سبب الرفض مطلوب' })
  scrapReason?: ProductionScrapReason;

  /** فارغ = دفعة الأمر */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  lotNumber?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  expiryDate?: string;

  /**
   * true = الاستلام الأخير: يُكمل الأمر، يحسب تكلفته الفعلية، ويستلم المنتجات
   * الثانوية. الوقت المفتوح يُغلق، والخطوات غير المنتهية تُعلَّم منتهية.
   */
  @IsOptional()
  @IsBoolean()
  final?: boolean;

  /** للاستلام الأخير: الكميات الفعلية للمنتجات الثانوية (فارغ = المخطط) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ByproductOutputDto)
  byproducts?: ByproductOutputDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CancelProductionOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

// ══════════════════════════ التخطيط والتقارير ══════════════════════════

export class MrpQueryDto {
  /** المخزن المحسوب رصيده. فارغ = كل المخازن */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  /** يضيف ما نقص عن حد إعادة الطلب للأصناف المصنّعة والمشتراة */
  @IsOptional()
  @IsIn(['true', 'false'])
  includeReorder?: string;

  /** أوامر محددة فقط (بفواصل). فارغ = كل الأوامر المفتوحة */
  @IsOptional()
  @IsString()
  orderIds?: string;
}

export class MrpPurchaseLineDto {
  @IsUUID()
  productId!: string;

  @IsNumber(QTY)
  @Min(0.0001)
  quantity!: number;

  @IsUUID()
  supplierId!: string;
}

export class MrpPurchaseDraftsDto {
  /** مخزن استلام المشتريات */
  @IsUUID()
  warehouseId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MrpPurchaseLineDto)
  lines!: MrpPurchaseLineDto[];
}

export class DateRangeQueryDto {
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  from!: string;

  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  to!: string;

  @IsOptional()
  @IsUUID()
  workCenterId?: string;
}
