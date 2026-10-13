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
  IsInt,
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
import { SalesPaymentMethod } from '../../sales/entities/customer-payment.entity';
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

// ══════════════════════════ الكاشيرات ══════════════════════════

const PIN_RULE = /^\d{4,6}$/;
const PIN_MESSAGE = 'الرقم السري: من 4 إلى 6 أرقام';

export class CreatePosCashierDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الكاشير مطلوب' })
  @MaxLength(150)
  name!: string;

  /** لا يُخزَّن نصاً ولا يُعاد في أي رد */
  @Matches(PIN_RULE, { message: PIN_MESSAGE })
  pin!: string;

  @IsOptional()
  @IsBoolean()
  canReturn?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePosCashierDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'اسم الكاشير مطلوب' })
  @MaxLength(150)
  name?: string;

  /** يُرسل فقط لتغيير الرقم */
  @IsOptional()
  @Matches(PIN_RULE, { message: PIN_MESSAGE })
  pin?: string;

  @IsOptional()
  @IsBoolean()
  canReturn?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ══════════════════════════ عمليات المزامنة ══════════════════════════

export class OpenShiftOp {
  @IsUUID()
  id!: string;

  @IsDateString()
  openedAt!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  openingCash!: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  cashierName?: string;

  /** الكاشير الذي فتحها برقمه السري (غائب = وردية بلا كاشير محدد) */
  @IsOptional()
  @IsUUID()
  cashierId?: string;
}

export class CloseShiftOp {
  @IsUUID()
  id!: string;

  @IsDateString()
  closedAt!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  closingCash!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** مرات فتح الدرج يدوياً بلا بيع خلال الوردية */
  @IsOptional()
  @IsInt()
  @Min(0)
  drawerOpens?: number;
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

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  discount!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxRate!: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  subtotal!: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  taxAmount!: number;

  @IsNumber({ maxDecimalPlaces: 3 })
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

export class PosReturnLineOp {
  /** ترتيب السطر في الفاتورة (0 = الأول) */
  @IsInt()
  @Min(0)
  lineIndex!: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity!: number;
}

export class PosReturnOp {
  /** معرّف المرتجع على الجهاز — يمنع تكراره عند إعادة الرفع */
  @IsUUID()
  uuid!: string;

  /** رقم الفاتورة المُرجَع منها كما طُبع على الإيصال */
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  invoiceNumber!: string;

  @IsDateString()
  issuedAt!: string;

  /** الوردية التي رُدّ المبلغ من درجها */
  @IsUUID()
  shiftId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PosReturnLineOp)
  lines!: PosReturnLineOp[];

  @IsEnum(SalesPaymentMethod)
  refundMethod!: SalesPaymentMethod;

  /** ما سلّمه الكاشير للعميل */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  refundAmount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export const POS_OPERATION_TYPES = [
  'shift.open',
  'sale',
  'return',
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

export class BindDeviceDto {
  /** معرّف يولّده المتصفح مرة واحدة ويحتفظ به */
  @IsUUID()
  installationId!: string;
}

export class PosSyncDto {
  @IsUUID()
  deviceId!: string;

  /** المتصفح المرسِل: يجب أن يكون هو المربوط بالجهاز */
  @IsUUID()
  installationId!: string;

  @IsArray()
  @ArrayMaxSize(MAX_SYNC_OPERATIONS)
  @ValidateNested({ each: true })
  @Type(() => PosOperationDto)
  operations!: PosOperationDto[];
}

/** رفع طابور الشاشة بهوية جهازها (الجهاز والشاشة في الترويسات) */
export class PosDeviceSyncDto {
  @IsArray()
  @ArrayMaxSize(MAX_SYNC_OPERATIONS)
  @ValidateNested({ each: true })
  @Type(() => PosOperationDto)
  operations!: PosOperationDto[];
}

export class PosDeviceBootstrapQueryDto {
  /** آخر مزامنة ناجحة: يُرسل ما تغيّر بعدها فقط. بدونه يُرسل كل شيء */
  @IsOptional()
  @IsDateString()
  since?: string;
}

export class PosBootstrapQueryDto {
  @IsUUID()
  deviceId!: string;

  @IsUUID()
  installationId!: string;

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
