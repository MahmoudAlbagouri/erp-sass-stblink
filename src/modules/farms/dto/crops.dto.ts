// src/modules/farms/dto/crops.dto.ts
// المحاصيل وأصنافها وتقويمها، الزراعات، وسجل النخيل والأشجار.
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
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { CropCategory, CropLifecycle } from '../entities/crop.entity';
import {
  DatePrecision,
  FarmOperationType,
  PlantingTrackingMode,
} from '../entities/farm-enums';
import {
  PlantRemovalReason,
  PlantSex,
  PlantSource,
  PlantStatus,
  PlantingEndReason,
  PlantingStatus,
} from '../entities/planting.entity';
import { DATE_MESSAGE, DATE_ONLY } from './farms.dto';

// ══════════════════════════ المحاصيل ══════════════════════════

export class CreateCropDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم المحصول مطلوب' })
  @MaxLength(120)
  name!: string;

  /** palm | fruit_tree | field_crop | vegetable | forage | greenhouse | ornamental | other */
  @IsEnum(CropCategory)
  category!: CropCategory;

  /** perennial (أشجار ونخيل) | annual (دورة) — فارغ = من الفئة */
  @IsOptional()
  @IsEnum(CropLifecycle)
  lifecycle?: CropLifecycle;

  /** individual | count | area — فارغ = من الفئة */
  @IsOptional()
  @IsEnum(PlantingTrackingMode)
  defaultTrackingMode?: PlantingTrackingMode;

  /** منتج الحصاد (صنف مخزني) */
  @IsOptional()
  @IsUUID()
  harvestProductId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCropDto extends PartialType(CreateCropDto) {}

export class CropVarietyDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الصنف مطلوب' })
  @MaxLength(120)
  name!: string;

  /** منتج حصاد الصنف (فارغ = منتج المحصول) */
  @IsOptional()
  @IsUUID()
  harvestProductId?: string | null;

  /** تكلفة معيارية لوحدة أساس منتج الحصاد: بها يدخل الحصاد المخزن */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  standardCost?: number | null;

  /** الإنتاج المتوقع للنبتة في الموسم (معمّر) */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  expectedYieldPerPlant?: number | null;

  /** الإنتاج المتوقع للهكتار في الدورة (حولي) */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  expectedYieldPerHectare?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  daysToHarvest?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  yearsToBearing?: number | null;

  /** أشهر الجني (1-12) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(12, { each: true })
  harvestMonths?: number[] | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCropVarietyDto extends PartialType(CropVarietyDto) {}

/** خطوة في التقويم الزراعي */
export class CalendarStepDto {
  /** فارغ = لكل أصناف المحصول */
  @IsOptional()
  @IsUUID()
  varietyId?: string | null;

  @IsEnum(FarmOperationType)
  operationType!: FarmOperationType;

  @IsString()
  @IsNotEmpty({ message: 'عنوان الخطوة مطلوب' })
  @MaxLength(150)
  title!: string;

  /** planting = بعد الزرع بأيام (حولي) | yearly = في شهر ويوم كل سنة (معمّر) */
  @IsIn(['planting', 'yearly'])
  anchor!: 'planting' | 'yearly';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  dayOffset?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  day?: number | null;

  /** تتكرر كل كم يوم */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  repeatEveryDays?: number | null;

  /** عدد المرات (مع التكرار) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  repeatCount?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpdateCalendarStepDto extends PartialType(CalendarStepDto) {}

// ══════════════════════════ الزراعات ══════════════════════════

export class CreatePlantingDto {
  @IsUUID()
  unitId!: string;

  @IsUUID()
  cropId!: string;

  @IsOptional()
  @IsUUID()
  varietyId?: string | null;

  /** فارغ = من المحصول */
  @IsOptional()
  @IsEnum(PlantingTrackingMode)
  trackingMode?: PlantingTrackingMode;

  /** العدد (count) — في individual يُحسب من السجل */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000000)
  plantCount?: number;

  /** م² — فارغ = مساحة الوحدة */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  areaM2?: number | null;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  plantedAt?: string | null;

  /** day | month | year | estimated */
  @IsOptional()
  @IsEnum(DatePrecision)
  plantedAtPrecision?: DatePrecision;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  season?: string | null;

  /** فارغ (حولي) = تاريخ الزرع + أيام الصنف حتى الحصاد */
  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  expectedHarvestAt?: string | null;

  /** الإنتاج المتوقع للموسم/الدورة — فارغ = من الصنف */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  expectedYield?: number | null;

  /** planned (لم تُزرع بعد) | active */
  @IsOptional()
  @IsIn([PlantingStatus.PLANNED, PlantingStatus.ACTIVE])
  status?: PlantingStatus;

  /** يولّد عمليات التقويم الزراعي المخططة (حولي) */
  @IsOptional()
  @IsBoolean()
  generatePlan?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpdatePlantingDto {
  @IsOptional()
  @IsUUID()
  varietyId?: string | null;

  /** للزراعة بالعدد */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000000)
  plantCount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  areaM2?: number | null;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  plantedAt?: string | null;

  @IsOptional()
  @IsEnum(DatePrecision)
  plantedAtPrecision?: DatePrecision;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  season?: string | null;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  expectedHarvestAt?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  expectedYield?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

/** بدء زراعة مخططة: زُرعت فعلاً */
export class ActivatePlantingDto {
  /** فارغ = اليوم */
  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  plantedAt?: string;
}

/** إنهاء زراعة (حُصدت، فشلت، قُلعت) بسببها */
export class ClosePlantingDto {
  @IsEnum(PlantingEndReason, { message: 'اختر سبب الإنهاء' })
  reason!: PlantingEndReason;

  /** فارغ = اليوم */
  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  closedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class PlantingQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  farmId?: string;

  /** الوحدة وما تحتها */
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsUUID()
  cropId?: string;

  /** planned | active | closed | failed | open (planned + active) */
  @IsOptional()
  @IsIn([...Object.values(PlantingStatus), 'open'])
  status?: PlantingStatus | 'open';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

/** خطة السنة من التقويم الزراعي (للمعمّر) */
export class GeneratePlanDto {
  /** فارغ = السنة الحالية */
  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2200)
  year?: number;
}

// ══════════════════════════ سجل النخيل والأشجار ══════════════════════════

/** صفوف تُسجَّل نخيلها دفعة واحدة */
export class BulkPlantsRowDto {
  /** الصف (أو الوحدة) — داخل وحدة الزراعة */
  @IsUUID()
  unitId!: string;

  @IsInt()
  @Min(1)
  @Max(5000)
  count!: number;

  /** أول رقم في الصف (الافتراضي بعد آخر نبتة فيه) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  startPosition?: number;
}

export class BulkPlantsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkPlantsRowDto)
  rows!: BulkPlantsRowDto[];

  @IsOptional()
  @IsEnum(PlantSex)
  sex?: PlantSex;

  /** فارغ = تاريخ الزراعة */
  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  plantedAt?: string | null;

  @IsOptional()
  @IsEnum(DatePrecision)
  plantedAtPrecision?: DatePrecision;

  @IsOptional()
  @IsEnum(PlantSource)
  source?: PlantSource;
}

export class CreatePlantDto {
  @IsUUID()
  unitId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  position?: number | null;

  /** فارغ = يُولَّد من أكواد الوحدات ورقمها */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tag?: string;

  @IsOptional()
  @IsEnum(PlantSex)
  sex?: PlantSex;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  plantedAt?: string | null;

  @IsOptional()
  @IsEnum(DatePrecision)
  plantedAtPrecision?: DatePrecision;

  @IsOptional()
  @IsEnum(PlantSource)
  source?: PlantSource;

  /** النخلة الأم (فسيلة) */
  @IsOptional()
  @IsUUID()
  motherPlantId?: string | null;

  /** تحل محل نبتة ماتت/قُلعت (تأخذ موقعها) */
  @IsOptional()
  @IsUUID()
  replacesPlantId?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpdatePlantDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tag?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  position?: number | null;

  @IsOptional()
  @IsEnum(PlantSex)
  sex?: PlantSex;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  plantedAt?: string | null;

  @IsOptional()
  @IsEnum(DatePrecision)
  plantedAtPrecision?: DatePrecision;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-90)
  @Max(90)
  latitude?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(-180)
  @Max(180)
  longitude?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

/** تغيير حالة نبتة (أُصيبت، تعافت، ماتت، قُلعت) */
export class PlantStatusDto {
  @IsEnum(PlantStatus)
  status!: PlantStatus;

  /** لماذا (نص) */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string | null;

  /** إلزامي للميتة والمقلوعة */
  @IsOptional()
  @IsEnum(PlantRemovalReason)
  removalReason?: PlantRemovalReason | null;

  /** وقت الحدث (فارغ = الآن) */
  @IsOptional()
  @IsString()
  occurredAt?: string;
}

export class PlantQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  farmId?: string;

  @IsOptional()
  @IsUUID()
  plantingId?: string;

  /** الوحدة وما تحتها */
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsUUID()
  varietyId?: string;

  /** حالة، أو live (القائمة) */
  @IsOptional()
  @IsIn([...Object.values(PlantStatus), 'live'])
  status?: PlantStatus | 'live';

  @IsOptional()
  @IsEnum(PlantSex)
  sex?: PlantSex;

  /** بالوسم */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;
}
