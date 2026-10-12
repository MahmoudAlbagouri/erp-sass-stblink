// src/modules/pos/dto/pos.dto.ts
import { PartialType } from '@nestjs/mapped-types';
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
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { TenderDto } from '../../sales/dto/sales.dto';
import { PosShiftStatus } from '../entities/pos.entity';

/** أقصى عدد عمليات في طلب مزامنة واحد (الجهاز يقسّم ما زاد) */
export const MAX_SYNC_OPERATIONS = 100;

// ══════════════════════════ الأجهزة ══════════════════════════

export class CreatePosDeviceDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الجهاز مطلوب' })
  @MaxLength(120)
  name!: string;

  /** بادئة أرقام فواتير الجهاز */
  @Matches(/^[A-Z0-9]{2,10}$/, {
    message: 'كود الجهاز: من 2 إلى 10 حروف إنجليزية كبيرة أو أرقام',
  })
  code!: string;

  @IsUUID(undefined, { message: 'المخزن مطلوب' })
  warehouseId!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** الكود لا يُعدَّل: فواتير الجهاز السابقة تحمله */
export class UpdatePosDeviceDto extends PartialType(CreatePosDeviceDto) {}

// ══════════════════════════ عمليات المزامنة ══════════════════════════

export class OpenShiftOp {
  @IsUUID()
  id!: string;

  @IsDateString()
  openedAt!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  openingCash!: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  cashierName?: string;
}

export class CloseShiftOp {
  @IsUUID()
  id!: string;

  @IsDateString()
  closedAt!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  closingCash!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PosSaleLineOp {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitPrice!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxRate!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  subtotal!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxAmount!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  total!: number;
}

export class PosSaleOp {
  /** معرّف الفاتورة على الجهاز — يمنع تكرارها عند إعادة الرفع */
  @IsUUID()
  uuid!: string;

  /** رقم الفاتورة كما طُبع: كود الجهاز-العدّاد */
  @Matches(/^[A-Z0-9]{2,10}-\d{1,9}$/, {
    message: 'رقم الفاتورة يجب أن يكون بصيغة: كود الجهاز-رقم',
  })
  number!: string;

  @IsDateString()
  issuedAt!: string;

  @IsUUID()
  shiftId!: string;

  @IsOptional()
  @IsUUID()
  customerId?: string | null;

  @IsBoolean()
  pricesIncludeTax!: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PosSaleLineOp)
  lines!: PosSaleLineOp[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => TenderDto)
  payments!: TenderDto[];
}

export const POS_OPERATION_TYPES = [
  'shift.open',
  'sale',
  'shift.close',
] as const;
export type PosOperationType = (typeof POS_OPERATION_TYPES)[number];

export class PosOperationDto {
  /** معرّف العملية في طابور الجهاز — يعود معه في النتيجة */
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  id!: string;

  @IsIn(POS_OPERATION_TYPES)
  type!: PosOperationType;

  /** يُتحقَّق منه لكل عملية على حدة: عملية فاسدة لا تُسقط الدفعة كلها */
  @IsObject()
  payload!: Record<string, unknown>;
}

export class PosSyncDto {
  @IsUUID()
  deviceId!: string;

  @IsArray()
  @ArrayMaxSize(MAX_SYNC_OPERATIONS)
  @ValidateNested({ each: true })
  @Type(() => PosOperationDto)
  operations!: PosOperationDto[];
}

export class PosBootstrapQueryDto {
  @IsUUID()
  deviceId!: string;

  /** آخر مزامنة ناجحة: يُرسل ما تغيّر بعدها فقط. بدونه يُرسل كل شيء */
  @IsOptional()
  @IsDateString()
  since?: string;
}

export class PosShiftQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @IsEnum(PosShiftStatus)
  status?: PosShiftStatus;
}
