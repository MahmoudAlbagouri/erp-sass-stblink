// src/modules/pos/dto/restaurant-menu.dto.ts — الإضافات، المحطات، الحجوزات، الهالك والتقارير
import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
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
import { ReservationStatus } from '../entities/restaurant-menu.entity';
import { KitchenOrderStatus } from '../entities/restaurant.entity';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD';

// ══════════════════════════ الإضافات ══════════════════════════

export class ModifierOptionDto {
  /** للتعديل: معرّف خيار قائم (يحفظ ارتباطه بالمبيعات السابقة) */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @IsNotEmpty({ message: 'اسم الخيار مطلوب' })
  @MaxLength(100)
  name!: string;

  /** يُضاف لسعر الوحدة (بأساس سعر الصنف) */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  priceDelta?: number;

  /** صنف يُستهلك مع كل وحدة (جبنة زيادة، مشروب الوجبة) */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  productId?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity?: number;

  /** مكوّن يُحذف من الوصفة ("بدون بصل") */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  removesProductId?: string | null;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateModifierGroupDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم المجموعة مطلوب' })
  @MaxLength(100)
  name!: string;

  /** أقل عدد يُختار (0 = اختيارية) */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  minSelect?: number;

  /** أقصى عدد يُختار (0 = بلا حد) */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  maxSelect?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => ModifierOptionDto)
  options!: ModifierOptionDto[];
}

export class UpdateModifierGroupDto extends PartialType(
  CreateModifierGroupDto,
) {}

export class ProductModifiersDto {
  /** المجموعات بترتيب ظهورها على الشاشة (فارغة = بلا إضافات) */
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  groupIds!: string[];
}

// ══════════════════════════ محطات المطبخ ══════════════════════════

export class CreateKitchenStationDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم المحطة مطلوب' })
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  branchId?: string | null;

  /** تصنيفات أصنافها (فارغة = تستلم ما لم تأخذه غيرها) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  categoryIds?: string[];

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(600)
  targetMinutes?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateKitchenStationDto extends PartialType(
  CreateKitchenStationDto,
) {}

export class StationStatusDto {
  @IsIn([
    KitchenOrderStatus.NEW,
    KitchenOrderStatus.PREPARING,
    KitchenOrderStatus.READY,
  ])
  status!: KitchenOrderStatus;
}

// ══════════════════════════ الحجوزات ══════════════════════════

export class CreateReservationDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم صاحب الحجز مطلوب' })
  @MaxLength(150)
  customerName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsInt()
  @Min(1)
  @Max(500)
  guestCount!: number;

  /** وقت الحجز (ISO) */
  @IsDateString({}, { message: 'وقت الحجز غير صالح' })
  reservedAt!: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(720)
  durationMinutes?: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  tableId?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  branchId?: string | null;

  @IsOptional()
  @IsIn(['phone', 'walk_in', 'online', 'other'])
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateReservationDto extends PartialType(CreateReservationDto) {}

export class ReservationStatusDto {
  @IsEnum(ReservationStatus)
  status!: ReservationStatus;
}

export class ReservationQueryDto {
  /** يوم الحجوزات (بتوقيت الشركة). فارغ = اليوم */
  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  date?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

// ══════════════════════════ الهالك والتقارير ══════════════════════════

export class DishWasteDto {
  @IsUUID()
  warehouseId!: string;

  /** طبق (صنف مركّب) أو مكوّن مخزني */
  @IsUUID()
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class RestaurantReportQueryDto {
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  from!: string;

  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  to!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
