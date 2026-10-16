// src/modules/delivery/dto/delivery.dto.ts
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
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { SalesLineDto } from '../../sales/dto/sales.dto';
import {
  PAYMENT_METHOD_MESSAGE,
  PUBLIC_PAYMENT_METHODS,
  SalesPaymentMethod,
} from '../../sales/entities/customer-payment.entity';
import {
  DeliveryAgentType,
  DeliveryOrderStatus,
  DeliveryPaymentMode,
} from '../entities/delivery.entity';

const MONEY = { maxDecimalPlaces: 3 };

// ══════════════════════════ جهات التوصيل ══════════════════════════

export class CreateDeliveryAgentDto {
  @IsEnum(DeliveryAgentType, { message: 'النوع: طيار أو شركة شحن' })
  type!: DeliveryAgentType;

  @IsString()
  @IsNotEmpty({ message: 'الاسم مطلوب' })
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  /** أجرة الطيار أو رسوم الشركة لكل أوردر (تُقترح عند الإسناد) */
  @IsOptional()
  @IsNumber(MONEY)
  @Min(0)
  defaultFee?: number;

  /** رسوم التحصيل % من المبلغ المحصّل */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  codFeePercent?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

export class UpdateDeliveryAgentDto extends PartialType(
  CreateDeliveryAgentDto,
) {}

export class DeliveryAgentQueryDto {
  @IsOptional()
  @IsEnum(DeliveryAgentType)
  type?: DeliveryAgentType;

  /** "true" = النشطة فقط */
  @IsOptional()
  @IsIn(['true', 'false'])
  active?: 'true' | 'false';
}

// ══════════════════════════ المناطق ══════════════════════════

export class CreateDeliveryZoneDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم المنطقة مطلوب' })
  @MaxLength(120)
  name!: string;

  /** رسوم التوصيل على العميل */
  @IsNumber(MONEY)
  @Min(0)
  fee!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10080)
  estimatedMinutes?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDeliveryZoneDto extends PartialType(CreateDeliveryZoneDto) {}

// ══════════════════════════ الأوردرات ══════════════════════════

export class CreateDeliveryOrderDto {
  /** المخزن الذي تخرج منه البضاعة */
  @IsUUID(undefined, { message: 'المخزن مطلوب' })
  warehouseId!: string;

  /** عميل مسجّل (اختياري) */
  @IsOptional()
  @IsUUID()
  customerId?: string | null;

  @IsString()
  @IsNotEmpty({ message: 'اسم المستلم مطلوب' })
  @MaxLength(150)
  recipientName!: string;

  @IsString()
  @IsNotEmpty({ message: 'رقم الجوال مطلوب' })
  @MaxLength(30)
  phone!: string;

  @IsString()
  @IsNotEmpty({ message: 'العنوان مطلوب' })
  @MaxLength(500)
  address!: string;

  @IsOptional()
  @IsUUID()
  zoneId?: string | null;

  /** رسوم التوصيل على العميل. الافتراضي رسوم المنطقة (أو 0) */
  @IsOptional()
  @IsNumber(MONEY)
  @Min(0)
  deliveryFee?: number;

  @IsEnum(DeliveryPaymentMode, {
    message: 'طريقة الدفع: تحصيل عند الاستلام أو مدفوع مقدماً',
  })
  paymentMode!: DeliveryPaymentMode;

  /** للمدفوع مقدماً: كيف دُفع (تحويل، بطاقة…) */
  @IsOptional()
  @IsIn(PUBLIC_PAYMENT_METHODS, { message: PAYMENT_METHOD_MESSAGE })
  prepaidMethod?: SalesPaymentMethod;

  /** إسناد فوري لطيار أو شركة شحن (اختياري) */
  @IsOptional()
  @IsUUID()
  agentId?: string | null;

  /** تكلفة التوصيل علينا. الافتراضي من بيانات الجهة */
  @IsOptional()
  @IsNumber(MONEY)
  @Min(0)
  agentFee?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  trackingNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;

  @IsArray()
  @ArrayMinSize(1, { message: 'أضف صنفاً واحداً على الأقل' })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SalesLineDto)
  lines!: SalesLineDto[];
}

export class AssignDeliveryOrderDto {
  @IsUUID(undefined, { message: 'اختر الطيار أو شركة الشحن' })
  agentId!: string;

  /** تكلفة التوصيل علينا. الافتراضي من بيانات الجهة */
  @IsOptional()
  @IsNumber(MONEY)
  @Min(0)
  agentFee?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  trackingNumber?: string | null;
}

export class FailDeliveryOrderDto {
  @IsString()
  @IsNotEmpty({ message: 'سبب عدم التسليم مطلوب' })
  @MaxLength(300)
  reason!: string;
}

// ══════════════════════════ شاشة الطيار: الرفع ══════════════════════════

export const DRIVER_OPERATION_TYPES = ['pickup', 'deliver', 'fail'] as const;
export type DriverOperationType = (typeof DRIVER_OPERATION_TYPES)[number];

/** عملية سجّلها الطيار على جواله (ربما بلا إنترنت) وتُرفع لاحقاً */
export class DriverOperationDto {
  /** معرّف العملية على الجوال: نتيجتها تعود به */
  @IsUUID()
  id!: string;

  /** pickup استلم وخرج، deliver سلّم، fail لم يُسلَّم */
  @IsIn(DRIVER_OPERATION_TYPES, { message: 'نوع العملية غير معروف' })
  type!: DriverOperationType;

  @IsUUID()
  orderId!: string;

  /** متى وقعت فعلاً على الجوال (قد يسبق وقت الرفع بساعات) */
  @IsDateString()
  occurredAt!: string;

  /** سبب عدم التسليم — إجباري لـ fail */
  @ValidateIf((op: DriverOperationDto) => op.type === 'fail')
  @IsString()
  @IsNotEmpty({ message: 'سبب عدم التسليم مطلوب' })
  @MaxLength(300)
  reason?: string;
}

export class DriverSyncDto {
  /** بترتيب وقوعها على الجوال */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DriverOperationDto)
  operations!: DriverOperationDto[];
}

export class DeliveryOrderQueryDto extends PaginationQueryDto {
  /** حالة أو أكثر مفصولة بفاصلة: "new,assigned" */
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsUUID()
  agentId?: string;

  /** "true" = المنتهية غير المسوّاة فقط (للتسوية) */
  @IsOptional()
  @IsIn(['true', 'false'])
  unsettled?: 'true' | 'false';

  /** رقم الأوردر أو الفاتورة أو اسم/جوال المستلم أو رقم البوليصة */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export const DELIVERY_STATUSES = Object.values(DeliveryOrderStatus);

// ══════════════════════════ التسويات ══════════════════════════

export class CreateDeliverySettlementDto {
  @IsUUID(undefined, { message: 'اختر الطيار أو شركة الشحن' })
  agentId!: string;

  /** الأوردرات المنتهية (مسلّمة أو راجعة) التي تشملها التسوية */
  @IsArray()
  @ArrayMinSize(1, { message: 'اختر أوردراً واحداً على الأقل' })
  @ArrayMaxSize(1000)
  @IsUUID(undefined, { each: true })
  orderIds!: string[];

  /** رسوم الجهة الفعلية (كشف شركة الشحن). الافتراضي مجموع تكلفة الأوردرات */
  @IsOptional()
  @IsNumber(MONEY)
  @Min(0)
  feesTotal?: number;

  /** ما استُلم فعلاً من الجهة */
  @IsNumber(MONEY)
  receivedAmount!: number;

  @IsIn(PUBLIC_PAYMENT_METHODS, { message: PAYMENT_METHOD_MESSAGE })
  method!: SalesPaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class DeliverySettlementQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  agentId?: string;
}
