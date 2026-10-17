// src/modules/pos/dto/restaurant.dto.ts
import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  NotEquals,
  ValidateNested,
} from 'class-validator';
import {
  KitchenOrderStatus,
  KitchenOrderType,
} from '../entities/restaurant.entity';

// ══════════════════════════ الطاولات ══════════════════════════

export class CreateDiningTableDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الطاولة مطلوب' })
  @MaxLength(60)
  name!: string;

  /** القسم: صالة، تراس، عائلات… */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  area?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  seats?: number;

  /** فرع الطاولة. فارغ = كل الفروع */
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDiningTableDto extends PartialType(CreateDiningTableDto) {}

/** طاولات متتالية دفعة واحدة: "طاولة 1" … "طاولة 20" */
export class BulkCreateTablesDto {
  /** ما يسبق الرقم */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  prefix?: string;

  @IsInt()
  @Min(1)
  @Max(9999)
  from!: number;

  @IsInt()
  @Min(1)
  @Max(9999)
  to!: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  area?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  seats?: number;

  @IsOptional()
  @IsUUID()
  branchId?: string | null;
}

export class UpdateRestaurantSettingsDto {
  /** تصنيفات تُحضَّر في المطبخ. فارغة = كل الأصناف */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  kitchenCategoryIds?: string[];

  @IsOptional()
  @IsBoolean()
  printKitchenTicket?: boolean;

  @IsOptional()
  @IsBoolean()
  sendOnPayment?: boolean;
}

// ══════════════════════════ المطبخ ══════════════════════════

export class KitchenLineOp {
  @IsOptional()
  @IsUUID()
  productId?: string | null;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  unitName?: string | null;

  /** سالبة = إلغاء ما أُرسل من قبل */
  @IsNumber({ maxDecimalPlaces: 4 })
  @NotEquals(0)
  @Min(-100000)
  @Max(100000)
  quantity!: number;

  /** "بدون بصل"، "سبايسي" */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string | null;
}

/** عملية طابور الجهاز kitchen.send: بون مطبخ */
export class KitchenSendOp {
  @IsUUID()
  id!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  ticketNo!: number;

  @IsOptional()
  @IsUUID()
  shiftId?: string | null;

  @IsIn(Object.values(KitchenOrderType))
  orderType!: KitchenOrderType;

  @IsOptional()
  @IsUUID()
  tableId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  tableName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string | null;

  @IsUUID()
  orderRef!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  round!: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  cashierName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;

  @IsDateString()
  sentAt!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => KitchenLineOp)
  lines!: KitchenLineOp[];
}

/** عملية طابور الجهاز kitchen.close: الطاولة دفعت — بوناتها سُلّمت */
export class KitchenCloseOp {
  @IsUUID()
  orderRef!: string;

  @IsDateString()
  closedAt!: string;
}

export class KitchenStatusDto {
  @IsIn(Object.values(KitchenOrderStatus))
  status!: KitchenOrderStatus;
}

export class KitchenBoardQueryDto {
  /** فرع المطبخ (لشركة بأكثر من فرع) */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
