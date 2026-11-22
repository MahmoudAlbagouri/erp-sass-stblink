// src/modules/farms/dto/farms.dto.ts
// المزارع وشجرة وحداتها، مصادر المياه، والطقس.
import { PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
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
} from 'class-validator';
import {
  FarmOwnership,
  FarmUnitKind,
  IrrigationMethod,
  SoilType,
  WaterSourceKind,
} from '../entities/farm.entity';

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const DATE_MESSAGE = 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD';

// ══════════════════════════ المزرعة ══════════════════════════

export class CreateFarmDto {
  /** فارغ = يُولَّد (FRM-000001) */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;

  @IsString()
  @IsNotEmpty({ message: 'اسم المزرعة مطلوب' })
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  /** المخزن الذي تُصرف منه المدخلات ويدخله الحصاد */
  @IsOptional()
  @IsUUID()
  warehouseId?: string | null;

  @IsOptional()
  @IsEnum(FarmOwnership)
  ownership?: FarmOwnership;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  leaseEndsOn?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  address?: string | null;

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

  /** حدود المزرعة: نقاط [خط الطول، خط العرض] (3 على الأقل) — منها المساحة */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(2000)
  boundary?: [number, number][] | null;

  /** م² — تُحسب من الحدود إن رُسمت */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  areaM2?: number | null;

  /** تكلفة ساعة العامل لتقارير التكلفة (اختيارية) */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  laborHourCost?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateFarmDto extends PartialType(CreateFarmDto) {}

// ══════════════════════════ وحدات المزرعة ══════════════════════════

export class CreateFarmUnitDto {
  /** الوحدة الأب (null = تحت المزرعة مباشرة) */
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  /** sector | block (حوش) | row | field | greenhouse | bed | nursery | other */
  @IsEnum(FarmUnitKind)
  kind!: FarmUnitKind;

  @IsString()
  @IsNotEmpty({ message: 'اسم الوحدة مطلوب' })
  @MaxLength(120)
  name!: string;

  /** كود قصير (A، 3، R12): يدخل في وسم النخلة */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^[\p{L}\p{N}._-]+$/u, {
    message: 'الكود حروف وأرقام بلا مسافات',
  })
  code?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(2000)
  boundary?: [number, number][] | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  areaM2?: number | null;

  @IsOptional()
  @IsEnum(SoilType)
  soilType?: SoilType | null;

  @IsOptional()
  @IsEnum(IrrigationMethod)
  irrigationMethod?: IrrigationMethod | null;

  /** تُروى كل كم يوم (لتنبيه "محتاج ري") — فارغ = من الأب */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  irrigationIntervalDays?: number | null;

  /** عدد الجور المخطط (صف 40 جورة) */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  plannedPositions?: number | null;

  @IsOptional()
  @IsUUID()
  waterSourceId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** تعديل وحدة؛ تغيير الأب ينقلها بما تحتها */
export class UpdateFarmUnitDto extends PartialType(CreateFarmUnitDto) {}

/** إضافة وحدات متتالية مرة واحدة: "صف 1" … "صف 40" */
export class BulkFarmUnitsDto {
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsEnum(FarmUnitKind)
  kind!: FarmUnitKind;

  @IsInt()
  @Min(1)
  @Max(500)
  count!: number;

  /** بادئة الاسم ("صف") يتبعها الرقم */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  namePrefix!: string;

  /** أول رقم (الافتراضي 1) */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  startNumber?: number;

  /** بادئة الكود ("R" ← R1، R2…) — فارغ = الرقم وحده */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  @Matches(/^[\p{L}\p{N}._-]*$/u, {
    message: 'البادئة حروف وأرقام بلا مسافات',
  })
  codePrefix?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  plannedPositions?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  areaM2?: number | null;

  @IsOptional()
  @IsEnum(SoilType)
  soilType?: SoilType | null;

  @IsOptional()
  @IsEnum(IrrigationMethod)
  irrigationMethod?: IrrigationMethod | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  irrigationIntervalDays?: number | null;
}

// ══════════════════════════ مصادر المياه ══════════════════════════

export class WaterSourceDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم المصدر مطلوب' })
  @MaxLength(120)
  name!: string;

  @IsEnum(WaterSourceKind)
  kind!: WaterSourceKind;

  /** م³ في الساعة */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  capacityM3PerHour?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  depthM?: number | null;

  /** ملوحة المياه (جزء في المليون) */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  salinityPpm?: number | null;

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

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateWaterSourceDto extends PartialType(WaterSourceDto) {}

// ══════════════════════════ الطقس ══════════════════════════

/** طقس يوم (يُستبدل إن سُجّل لنفس اليوم) */
export class WeatherLogDto {
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  date!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(-60)
  @Max(70)
  tempMin?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(-60)
  @Max(70)
  tempMax?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(2000)
  rainMm?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  humidity?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(400)
  windKmh?: number | null;

  @IsOptional()
  @IsBoolean()
  frost?: boolean;

  @IsOptional()
  @IsBoolean()
  dustStorm?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class WeatherQueryDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  to?: string;
}
