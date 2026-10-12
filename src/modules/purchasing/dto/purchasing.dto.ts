// src/modules/purchasing/dto/purchasing.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
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
import { PurchaseInvoiceStatus } from '../entities/purchase-invoice.entity';
import { PurchaseReturnStatus } from '../entities/purchase-return.entity';
import {
  PaymentMethod,
  SupplierPaymentStatus,
} from '../entities/supplier-payment.entity';

const MAX_LINES = 500;
/** تاريخ بلا وقت: 2026-10-12 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD';

// ══════════════════════════ الموردون ══════════════════════════

export class CreateSupplierDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم المورد مطلوب' })
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactPerson?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @Matches(/^\d{15}$/, { message: 'الرقم الضريبي يتكون من 15 رقماً' })
  taxNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  commercialRegister?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  openingBalance?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}

export class SupplierQueryDto extends PaginationQueryDto {
  /** بحث بالاسم أو الكود أو الهاتف أو الرقم الضريبي */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;

  /** true = من لهم مستحقات فقط */
  @IsOptional()
  @IsIn(['true'])
  withBalance?: string;
}

export class StatementQueryDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  to?: string;
}

// ══════════════════════════ فواتير الشراء ══════════════════════════

export class PurchaseLineDto {
  @IsUUID()
  productId!: string;

  /** وحدة الشراء. إذا تُركت = وحدة الأساس */
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001, { message: 'الكمية يجب أن تكون أكبر من صفر' })
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0, { message: 'السعر لا يقل عن صفر' })
  unitPrice!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discount?: number;

  /** إذا تُركت = ضريبة الصنف */
  @IsOptional()
  @IsUUID()
  taxRateId?: string;
}

export class CreatePurchaseInvoiceDto {
  @IsUUID(undefined, { message: 'المورد مطلوب' })
  supplierId!: string;

  @IsUUID(undefined, { message: 'المخزن مطلوب' })
  warehouseId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  supplierReference?: string;

  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  invoiceDate!: string;

  /** إذا تُرك يُحسب من مهلة سداد المورد */
  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  dueDate?: string;

  @IsOptional()
  @IsBoolean()
  pricesIncludeTax?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'أضف صنفاً واحداً على الأقل' })
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  lines!: PurchaseLineDto[];
}

export class UpdatePurchaseInvoiceDto extends PartialType(
  CreatePurchaseInvoiceDto,
) {}

export class PurchaseInvoiceQueryDto extends PaginationQueryDto {
  /** بحث برقم الفاتورة أو رقم فاتورة المورد */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(PurchaseInvoiceStatus)
  status?: PurchaseInvoiceStatus;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  /** due = عليها متبقٍ، overdue = تجاوزت تاريخ الاستحقاق */
  @IsOptional()
  @IsIn(['due', 'overdue'])
  payment?: 'due' | 'overdue';

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

// ══════════════════════════ المرتجعات ══════════════════════════

export class ReturnLineDto {
  @IsUUID()
  invoiceLineId!: string;

  /** بوحدة الشراء في الفاتورة */
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001, { message: 'الكمية يجب أن تكون أكبر من صفر' })
  quantity!: number;
}

export class CreatePurchaseReturnDto {
  @IsUUID()
  invoiceId!: string;

  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  returnDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'أضف صنفاً واحداً على الأقل' })
  @ArrayMaxSize(MAX_LINES)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];
}

export class PurchaseReturnQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PurchaseReturnStatus)
  status?: PurchaseReturnStatus;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  invoiceId?: string;
}

// ══════════════════════════ السداد ══════════════════════════

export class CreateSupplierPaymentDto {
  @IsUUID(undefined, { message: 'المورد مطلوب' })
  supplierId!: string;

  /** إذا تُرك = دفعة على الحساب */
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  paymentDate!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'المبلغ يجب أن يكون أكبر من صفر' })
  amount!: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SupplierPaymentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsOptional()
  @IsEnum(SupplierPaymentStatus)
  status?: SupplierPaymentStatus;
}
