// src/modules/accounting/dto/accounting.dto.ts
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
  IsObject,
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
import { COUNTRY_CODES } from '../../../common/constants/countries';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  JournalSource,
  MAX_MANUAL_LINES,
  PartyType,
} from '../accounting.constants';

const MONEY = { maxDecimalPlaces: 3 };
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'التاريخ بصيغة YYYY-MM-DD';

// ══════════════════════════ شجرة الحسابات ══════════════════════════

export class CreateAccountDto {
  /** الحساب التجميعي الذي يُضاف تحته */
  @IsUUID(undefined, { message: 'اختر الحساب الأب' })
  parentId!: string;

  /** يبدأ بكود الأب. فارغ = التالي تلقائياً (110101، 110102…) */
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,20}$/, { message: 'الكود أرقام فقط (حتى 20 رقماً)' })
  code?: string;

  @IsString()
  @IsNotEmpty({ message: 'اسم الحساب مطلوب' })
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameEn?: string | null;

  /** تجميعي: أب لحسابات ولا يُرحَّل عليه */
  @IsOptional()
  @IsBoolean()
  isGroup?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;
}

export class UpdateAccountDto {
  /** نقله تحت حساب تجميعي آخر من نفس النوع (بلا حسابات تحته) */
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,20}$/, { message: 'الكود أرقام فقط (حتى 20 رقماً)' })
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'اسم الحساب مطلوب' })
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameEn?: string | null;

  @IsOptional()
  @IsBoolean()
  isGroup?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;
}

// ══════════════════════════ القيود ══════════════════════════

export class JournalLineDto {
  @IsUUID(undefined, { message: 'اختر الحساب' })
  accountId!: string;

  /** طرف واحد في السطر: مدين أو دائن */
  @IsOptional()
  @IsNumber(MONEY)
  @Min(0)
  debit?: number;

  @IsOptional()
  @IsNumber(MONEY)
  @Min(0)
  credit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  /** مركز التكلفة */
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  /** الطرف (للدفتر المساعد): customer / supplier / employee / courier */
  @IsOptional()
  @IsIn(Object.values(PartyType))
  partyType?: PartyType | null;

  @ValidateIf((line: JournalLineDto) => !!line.partyType)
  @IsUUID(undefined, { message: 'اختر الطرف' })
  partyId?: string | null;
}

export class CreateJournalEntryDto {
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  date!: string;

  @IsString()
  @IsNotEmpty({ message: 'بيان القيد مطلوب' })
  @MaxLength(500)
  description!: string;

  @IsArray()
  @ArrayMinSize(2, { message: 'القيد طرفان على الأقل' })
  @ArrayMaxSize(MAX_MANUAL_LINES)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];
}

export class ReverseJournalEntryDto {
  /** تاريخ قيد العكس (في فترة مفتوحة) */
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  date!: string;
}

export class JournalQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  to?: string;

  @IsOptional()
  @IsIn(Object.values(JournalSource))
  sourceType?: JournalSource;

  /** القيود التي تمس هذا الحساب */
  @IsOptional()
  @IsUUID()
  accountId?: string;

  /** رقم القيد أو بيانه أو رقم مستنده */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

// ══════════════════════════ الإعدادات ══════════════════════════

export class ActivateAccountingDto {
  /** دولة الشجرة الجاهزة. الافتراضي دولة الشركة */
  @IsOptional()
  @IsIn(COUNTRY_CODES as string[], { message: 'دولة غير مدعومة' })
  country?: string;
}

export class UpdateAccountingSettingsDto {
  /** قفل الفترة حتى هذا اليوم (شاملاً). null يفتحها */
  @IsOptional()
  @ValidateIf((dto: UpdateAccountingSettingsDto) => dto.lockDate !== null)
  @IsDateString({ strict: true }, { message: DATE_MESSAGE })
  lockDate?: string | null;

  /** طريقة القبض (cash، card، bank_transfer، cheque) ← معرّف الحساب */
  @IsOptional()
  @IsObject()
  receiptAccounts?: Record<string, string>;

  /** طريقة الدفع (cash، bank_transfer، card، cheque) ← معرّف الحساب */
  @IsOptional()
  @IsObject()
  paymentAccounts?: Record<string, string>;
}

// ══════════════════════════ التقارير ══════════════════════════

export class PeriodQueryDto {
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  from!: string;

  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  to!: string;

  /** مركز تكلفة واحد (فرع) */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class TrialBalanceQueryDto extends PeriodQueryDto {
  /** أقصى مستوى يُعرض (1 = الرئيسية فقط). الافتراضي كل المستويات */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  level?: number;
}

export class LedgerQueryDto extends PeriodQueryDto {
  /** حساب فرعي، أو تجميعي فيشمل كل ما تحته */
  @IsUUID(undefined, { message: 'اختر الحساب' })
  accountId!: string;

  @IsOptional()
  @IsIn(Object.values(PartyType))
  partyType?: PartyType;

  @ValidateIf((query: LedgerQueryDto) => !!query.partyType)
  @IsUUID()
  partyId?: string;
}

export class BalanceSheetQueryDto {
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  asOf!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

// ══════════════════════════ سندات الصرف ══════════════════════════

export class ExpenseLineDto {
  /** حساب المصروف (فرعي) */
  @IsUUID(undefined, { message: 'اختر حساب المصروف' })
  accountId!: string;

  /** المبلغ قبل الضريبة */
  @IsNumber(MONEY)
  @Min(0.001, { message: 'المبلغ أكبر من صفر' })
  amount!: number;

  /** نسبة الضريبة % (صفر أو غيابها = بلا ضريبة) */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;

  /** مركز التكلفة */
  @IsOptional()
  @IsUUID()
  branchId?: string | null;
}

export class CreateExpenseVoucherDto {
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  date!: string;

  /** الصندوق أو البنك الذي يُدفع منه (حساب أصول فرعي) */
  @IsUUID(undefined, { message: 'اختر الصندوق أو البنك' })
  paidFromAccountId!: string;

  @IsString()
  @IsNotEmpty({ message: 'المستفيد مطلوب' })
  @MaxLength(150)
  payee!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  payeeTaxNumber?: string | null;

  /** رقم فاتورة المستفيد أو الإيصال */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  reference?: string | null;

  @IsString()
  @IsNotEmpty({ message: 'البيان مطلوب' })
  @MaxLength(500)
  description!: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'أضف بنداً واحداً على الأقل' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ExpenseLineDto)
  lines!: ExpenseLineDto[];
}

export class CancelExpenseVoucherDto {
  /** تاريخ قيد الإلغاء (في فترة مفتوحة) */
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  date!: string;

  @IsString()
  @IsNotEmpty({ message: 'سبب الإلغاء مطلوب' })
  @MaxLength(300)
  reason!: string;
}

export class ExpenseQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  to?: string;

  @IsOptional()
  @IsIn(['posted', 'cancelled'])
  status?: 'posted' | 'cancelled';

  /** السندات التي فيها هذا الحساب (مصروفاً أو صندوقاً) */
  @IsOptional()
  @IsUUID()
  accountId?: string;

  /** رقم السند أو المستفيد أو المرجع أو البيان */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

// ══════════════════════════ الضريبة والإقفال ══════════════════════════

export class VatReturnQueryDto {
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  from!: string;

  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  to!: string;
}
