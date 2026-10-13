// src/modules/sales/dto/sales.dto.ts
import { PartialType } from '@nestjs/swagger';
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
import {
  CustomerPaymentStatus,
  PaymentDirection,
  SalesPaymentMethod,
} from '../entities/customer-payment.entity';
import { SalesInvoiceStatus } from '../entities/sales-invoice.entity';
import { SalesReturnStatus } from '../entities/sales-return.entity';

const MAX_LINES = 500;
/** تاريخ بلا وقت: 2026-10-12 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD';
const TAX_NUMBER = /^\d{15}$/;
const TAX_NUMBER_MESSAGE = 'الرقم الضريبي يتكون من 15 رقماً';

// ══════════════════════════ إعدادات الفوترة ══════════════════════════

export class ScaleBarcodeOptionsDto {
  @IsBoolean()
  enabled!: boolean;

  /** بادئات الباركود الموزون (خانتان لكل بادئة) */
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(/^\d{2}$/, { each: true, message: 'بادئة الميزان خانتان رقميتان' })
  prefixes!: string[];

  /** خانات كود الصنف بعد البادئة (القيمة تأخذ الباقي حتى 12 خانة) */
  @IsInt()
  @Min(4)
  @Max(6)
  itemDigits!: number;

  @IsIn(['weight', 'price'])
  valueType!: 'weight' | 'price';

  @IsInt()
  @Min(0)
  @Max(3)
  valueDecimals!: number;
}

export class PosApprovalsDto {
  /** حذف سطر أو إفراغ السلة أو حذف فاتورة معلّقة */
  @IsBoolean()
  void!: boolean;

  @IsBoolean()
  cashOut!: boolean;

  @IsBoolean()
  manualDrawer!: boolean;
}

export class PosOptionsDto {
  @ValidateNested()
  @Type(() => ScaleBarcodeOptionsDto)
  scale!: ScaleBarcodeOptionsDto;

  @ValidateNested()
  @Type(() => PosApprovalsDto)
  approvals!: PosApprovalsDto;
}

export class UpdateSalesSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sellerName?: string | null;

  @IsOptional()
  @Matches(TAX_NUMBER, { message: TAX_NUMBER_MESSAGE })
  taxNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  commercialRegister?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  invoiceFooter?: string | null;

  /** إعدادات شاشة الكاشير: باركود الميزان وما يحتاج موافقة مشرف */
  @IsOptional()
  @ValidateNested()
  @Type(() => PosOptionsDto)
  posOptions?: PosOptionsDto;
}

// ══════════════════════════ العملاء ══════════════════════════

export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم العميل مطلوب' })
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'البريد الإلكتروني غير صحيح' })
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @Matches(TAX_NUMBER, { message: TAX_NUMBER_MESSAGE })
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

  /** null = بلا حد ائتماني */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  creditLimit?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  openingBalance?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}

export class CustomerQueryDto extends PaginationQueryDto {
  /** بحث بالاسم أو الكود أو الهاتف أو الرقم الضريبي */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;

  /** true = من عليهم (أو لهم) رصيد فقط */
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

// ══════════════════════════ فواتير البيع ══════════════════════════

export class SalesLineDto {
  @IsUUID()
  productId!: string;

  /** وحدة البيع. إذا تُركت = وحدة الأساس */
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
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  discount?: number;
}

export class CreateSalesInvoiceDto {
  /**
   * معرّف يولّده العميل (الكاشير). إرسال نفس المعرّف مرتين يعيد الفاتورة
   * نفسها ولا ينشئ ثانية — أساس الرفع الآمن بعد انقطاع الشبكة.
   */
  @IsOptional()
  @IsUUID()
  uuid?: string;

  /** إذا تُرك = بيع نقدي لعميل عابر */
  @IsOptional()
  @IsUUID()
  customerId?: string | null;

  @IsUUID(undefined, { message: 'المخزن مطلوب' })
  warehouseId!: string;

  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  invoiceDate!: string;

  /** إذا تُرك يُحسب من مهلة سداد العميل */
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
  @Type(() => SalesLineDto)
  lines!: SalesLineDto[];
}

export class UpdateSalesInvoiceDto extends PartialType(CreateSalesInvoiceDto) {}

export class TenderDto {
  @IsEnum(SalesPaymentMethod)
  method!: SalesPaymentMethod;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.01, { message: 'المبلغ يجب أن يكون أكبر من صفر' })
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  reference?: string;
}

export class IssueSalesInvoiceDto {
  /** ما قُبض عند الإصدار (يمكن تقسيمه: نقدي + شبكة) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => TenderDto)
  payments?: TenderDto[];
}

export class SalesInvoiceQueryDto extends PaginationQueryDto {
  /** بحث برقم الفاتورة أو اسم العميل */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(SalesInvoiceStatus)
  status?: SalesInvoiceStatus;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

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

export class SalesReturnLineDto {
  @IsUUID()
  invoiceLineId!: string;

  /** بوحدة البيع في الفاتورة */
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001, { message: 'الكمية يجب أن تكون أكبر من صفر' })
  quantity!: number;
}

export class CreateSalesReturnDto {
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
  @Type(() => SalesReturnLineDto)
  lines!: SalesReturnLineDto[];
}

export class IssueSalesReturnDto {
  /** ما يُردّ للعميل نقداً الآن (من المدفوع الزائد بعد المرتجع) */
  @IsOptional()
  @ValidateNested()
  @Type(() => TenderDto)
  refund?: TenderDto;
}

export class SalesReturnQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(SalesReturnStatus)
  status?: SalesReturnStatus;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  invoiceId?: string;
}

// ══════════════════════════ المقبوضات ══════════════════════════

export class CreateCustomerPaymentDto {
  /** مطلوب لدفعة على الحساب. مع فاتورة يؤخذ العميل منها */
  @IsOptional()
  @IsUUID()
  customerId?: string;

  /** إذا تُرك = دفعة على الحساب */
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  /** الفرع القابض لدفعة على الحساب (مع فاتورة يؤخذ من مخزنها) */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  paymentDate!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.01, { message: 'المبلغ يجب أن يكون أكبر من صفر' })
  amount!: number;

  @IsOptional()
  @IsEnum(SalesPaymentMethod)
  method?: SalesPaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CustomerPaymentQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsOptional()
  @IsEnum(CustomerPaymentStatus)
  status?: CustomerPaymentStatus;

  @IsOptional()
  @IsEnum(PaymentDirection)
  direction?: PaymentDirection;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}
