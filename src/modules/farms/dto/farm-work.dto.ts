// src/modules/farms/dto/farm-work.dto.ts
// العمل الميداني: العمليات الزراعية، الحصاد، فحص الآفات، والمزامنة بلا إنترنت.
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { FarmOperationType } from '../entities/farm-enums';
import {
  FarmOperationStatus,
  HarvestGrade,
  HarvestRejectReason,
  HarvestStatus,
  InspectionStatus,
  PestType,
} from '../entities/farm-work.entity';
import { DATE_MESSAGE, DATE_ONLY } from './farms.dto';

// ══════════════════════════ العمليات ══════════════════════════

export class OperationInputDto {
  /** المدخل (صنف مخزني: سماد، مبيد، بذور) */
  @IsUUID()
  productId!: string;

  /** فارغ = مخزن المزرعة */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  /** بوحدة أساس الصنف */
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity!: number;

  /** فترة الأمان قبل الحصاد بالأيام (للمبيد) */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  phiDays?: number | null;
}

export class OperationWorkerDto {
  /** موظف مسجّل (أو اسم فقط) */
  @IsOptional()
  @IsUUID()
  employeeId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(24)
  hours?: number | null;
}

/** ما يُسجَّل عند التنفيذ (مشترك بين التسجيل المباشر وإتمام المخطط) */
export class OperationActualsDto {
  /** بداية التنفيذ (ISO) — فارغ = الآن */
  @IsOptional()
  @IsString()
  performedAt?: string;

  @IsOptional()
  @IsString()
  endedAt?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  durationMinutes?: number | null;

  /** كمية عامة (عذوق لُقّحت، فسائل فُصلت) */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  quantity?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  quantityUnit?: string | null;

  /** م³ مياه */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  waterM3?: number | null;

  @IsOptional()
  @IsUUID()
  waterSourceId?: string | null;

  /** فارغ = يُحسب من النخيل المختار أو الزراعة أو الوحدة */
  @IsOptional()
  @IsInt()
  @Min(0)
  plantsCovered?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  areaCoveredM2?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  workerCount?: number | null;

  /** مجموع الساعات — فارغ = مجموع ساعات العمال */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  laborHours?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => OperationWorkerDto)
  workers?: OperationWorkerDto[];

  /** المدخلات المصروفة: تخرج من المخزن بتكلفتها */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OperationInputDto)
  inputs?: OperationInputDto[];

  /** نخيل/أشجار بعينها شملتها العملية */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsUUID('all', { each: true })
  plantIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(30)
  targetPest?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  supervisorName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class CreateOperationDto extends OperationActualsDto {
  @IsUUID()
  farmId!: string;

  /** الوحدة وما تحتها (فارغ = المزرعة كلها) */
  @IsOptional()
  @IsUUID()
  unitId?: string | null;

  @IsOptional()
  @IsUUID()
  plantingId?: string | null;

  @IsEnum(FarmOperationType)
  type!: FarmOperationType;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  title?: string | null;

  /** planned (مخطط لموعد) | done (نُفّذ) — الافتراضي done */
  @IsOptional()
  @IsIn([FarmOperationStatus.PLANNED, FarmOperationStatus.DONE])
  status?: FarmOperationStatus;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  plannedDate?: string | null;

  /** علاج لفحص آفة (يصير "قيد العلاج") */
  @IsOptional()
  @IsUUID()
  inspectionId?: string | null;

  /** معرّف الجهاز (يمنع تكرار الرفع) */
  @IsOptional()
  @IsUUID()
  clientUuid?: string;
}

/** إتمام عملية مخططة بما نُفّذ فعلاً */
export class CompleteOperationDto extends OperationActualsDto {
  @IsOptional()
  @IsUUID()
  clientUuid?: string;
}

/** إلغاء مخطط، أو إبطال منفّذ (تعود مدخلاته للمخزن) */
export class CancelOperationDto {
  @IsString()
  @IsNotEmpty({ message: 'سبب الإلغاء مطلوب' })
  @MaxLength(200)
  reason!: string;
}

export class OperationQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  farmId?: string;

  /** الوحدة وما تحتها وما فوقها (عملية على الحوش تشمل صفوفه) */
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsUUID()
  plantingId?: string;

  /** عمليات شملت نخلة بعينها */
  @IsOptional()
  @IsUUID()
  plantId?: string;

  @IsOptional()
  @IsEnum(FarmOperationType)
  type?: FarmOperationType;

  @IsOptional()
  @IsEnum(FarmOperationStatus)
  status?: FarmOperationStatus;

  /** overdue (مخطط فات موعده) | upcoming (خلال 7 أيام) */
  @IsOptional()
  @IsIn(['overdue', 'upcoming'])
  due?: 'overdue' | 'upcoming';

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

/** خطة السنة من التقويم للمزرعة كلها (للمعمّر) */
export class GenerateFarmPlanDto {
  @IsUUID()
  farmId!: string;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2200)
  year?: number;
}

// ══════════════════════════ الحصاد ══════════════════════════

export class CreateHarvestDto {
  @IsUUID()
  farmId!: string;

  @IsOptional()
  @IsUUID()
  unitId?: string | null;

  @IsOptional()
  @IsUUID()
  plantingId?: string | null;

  /** نخلة بعينها (جني نخلة نخلة) */
  @IsOptional()
  @IsUUID()
  plantId?: string | null;

  /** وقت الجني (ISO) — فارغ = الآن */
  @IsOptional()
  @IsString()
  harvestedAt?: string;

  /** منتج الحصاد — فارغ = منتج الصنف أو المحصول */
  @IsOptional()
  @IsUUID()
  productId?: string;

  /** فارغ = مخزن المزرعة */
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  /** الصافي الذي يدخل المخزن (وحدة أساس المنتج) */
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  quantity!: number;

  /** القائم قبل الفرز */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  grossQuantity?: number | null;

  /** عذوق / صناديق */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000000)
  containers?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  containerLabel?: string | null;

  /** extra | first | second | third | industrial */
  @IsOptional()
  @IsEnum(HarvestGrade)
  grade?: HarvestGrade | null;

  /** المرفوض (لا يدخل المخزن) */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  rejectQuantity?: number | null;

  @IsOptional()
  @IsEnum(HarvestRejectReason)
  rejectReason?: HarvestRejectReason | null;

  /** قيمة الوحدة — فارغ = التكلفة المعيارية للصنف، أو متوسط المنتج */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitCost?: number | null;

  /** فارغ = كود المزرعة وتاريخ الجني */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  lotNumber?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  workerCount?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  laborHours?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  supervisorName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsUUID()
  clientUuid?: string;
}

export class VoidHarvestDto {
  @IsString()
  @IsNotEmpty({ message: 'سبب الإلغاء مطلوب' })
  @MaxLength(200)
  reason!: string;
}

export class HarvestQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  farmId?: string;

  /** الوحدة وما تحتها */
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsUUID()
  plantingId?: string;

  @IsOptional()
  @IsUUID()
  plantId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsEnum(HarvestStatus)
  status?: HarvestStatus;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  to?: string;
}

// ══════════════════════════ الآفات ══════════════════════════

export class CreateInspectionDto {
  @IsUUID()
  farmId!: string;

  @IsOptional()
  @IsUUID()
  unitId?: string | null;

  @IsOptional()
  @IsUUID()
  plantingId?: string | null;

  @IsOptional()
  @IsUUID()
  plantId?: string | null;

  /** وقت الفحص (ISO) — فارغ = الآن */
  @IsOptional()
  @IsString()
  inspectedAt?: string;

  @IsEnum(PestType, { message: 'اختر الآفة' })
  pest!: PestType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  pestName?: string | null;

  /** 0 لا شيء، 1 خفيفة، 2 متوسطة، 3 شديدة، 4 حرجة */
  @IsInt()
  @Min(0)
  @Max(4)
  severity!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  affectedCount?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sampledCount?: number | null;

  /** يعلّم النخلة المصابة في السجل (الافتراضي نعم إن كانت الشدة > 0) */
  @IsOptional()
  @IsBoolean()
  markPlant?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  inspectorName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsUUID()
  clientUuid?: string;
}

export class InspectionStatusDto {
  @IsEnum(InspectionStatus)
  status!: InspectionStatus;

  @IsOptional()
  @IsUUID()
  treatmentOperationId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class InspectionQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  farmId?: string;

  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsUUID()
  plantId?: string;

  @IsOptional()
  @IsEnum(InspectionStatus)
  status?: InspectionStatus;

  @IsOptional()
  @IsEnum(PestType)
  pest?: PestType;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  to?: string;
}

// ══════════════════════════ الشاشة الميدانية ══════════════════════════

export const FIELD_OP_TYPES = [
  'operation',
  'operation_complete',
  'harvest',
  'inspection',
  'plant_status',
] as const;
export type FieldOpType = (typeof FIELD_OP_TYPES)[number];

/** عملية سجّلها الجهاز في الميدان */
export class FieldOpDto {
  /** معرّف من الجهاز: إعادة رفعه = duplicate */
  @IsUUID()
  id!: string;

  @IsIn(FIELD_OP_TYPES)
  type!: FieldOpType;

  /** وقت الحدث على الجهاز (ISO) */
  @IsString()
  occurredAt!: string;

  /** بيانات العملية بحسب نوعها (حقل غير معروف يُهمل) */
  @IsObject()
  payload!: Record<string, unknown>;
}

export class FieldSyncDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => FieldOpDto)
  operations!: FieldOpDto[];
}

export class FieldBootstrapQueryDto {
  /** مزرعة واحدة (سجل نخيلها كاملاً) — فارغ = كل المزارع بلا السجل */
  @IsOptional()
  @IsUUID()
  farmId?: string;
}

// ══════════════════════════ التقارير ══════════════════════════

export class FarmReportQueryDto {
  @IsOptional()
  @IsUUID()
  farmId?: string;

  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsOptional()
  @IsUUID()
  cropId?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  from?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: DATE_MESSAGE })
  to?: string;

  /** planting | variety | unit | plant | type | month (بحسب التقرير) */
  @IsOptional()
  @IsIn(['planting', 'variety', 'unit', 'plant', 'type', 'month'])
  groupBy?: 'planting' | 'variety' | 'unit' | 'plant' | 'type' | 'month';
}
