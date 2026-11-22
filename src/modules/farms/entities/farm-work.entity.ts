// src/modules/farms/entities/farm-work.entity.ts
//
// العمل في الأرض كما حدث: العملية الزراعية (مخططة ← نُفّذت أو أُلغيت) بمدخلاتها
// وعمالها ومياهها ووقتها الفعلي، والحصاد بوزنه وجودته ومرفوضه وسببه، وفحص
// الآفات بشدته. كل ما يُسجَّل من الشاشة الميدانية بلا إنترنت يحمل clientUuid
// فإعادة رفعه لا تكرره.
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';
import { Product } from '../../catalog/entities/product.entity';
import { Warehouse } from '../../inventory/entities/warehouse.entity';
import { FarmOperationType } from './farm-enums';
import { area, Farm, FarmUnit, FarmWaterSource } from './farm.entity';
import { FarmPlant, Planting } from './planting.entity';

const quantity = {
  type: 'numeric' as const,
  precision: 14,
  scale: 4,
  default: 0,
  transformer: decimalTransformer,
};
const optionalQuantity = { ...quantity, default: undefined, nullable: true };
const money = {
  type: 'numeric' as const,
  precision: 15,
  scale: 3,
  default: 0,
  transformer: decimalTransformer,
};
const hours = {
  type: 'numeric' as const,
  precision: 10,
  scale: 2,
  nullable: true,
  transformer: decimalTransformer,
};

export enum FarmOperationStatus {
  PLANNED = 'planned',
  DONE = 'done',
  CANCELLED = 'cancelled',
}

@Entity('farm_operations')
@Index(['tenantId', 'number'], { unique: true })
@Index(['tenantId', 'clientUuid'], {
  unique: true,
  where: '"clientUuid" IS NOT NULL',
})
@Index(['tenantId', 'farmId', 'status', 'plannedDate'])
@Index(['unitId', 'type', 'performedAt'])
export class FarmOperation extends TenantOwnedEntity {
  /** OPR-000001 */
  @Column({ type: 'varchar', length: 20 })
  number!: string;

  @Column({ type: 'uuid' })
  farmId!: string;

  @ManyToOne(() => Farm, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'farmId' })
  farm?: Farm;

  /** الوحدة (وما تحتها) التي شملتها. null = المزرعة كلها */
  @Column({ type: 'uuid', nullable: true })
  unitId?: string | null;

  @ManyToOne(() => FarmUnit, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'unitId' })
  unit?: FarmUnit | null;

  @Column({ type: 'uuid', nullable: true })
  plantingId?: string | null;

  @ManyToOne(() => Planting, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'plantingId' })
  planting?: Planting | null;

  @Column({ type: 'varchar', length: 30 })
  type!: FarmOperationType;

  @Column({ type: 'varchar', length: 150, nullable: true })
  title?: string | null;

  @Column({ type: 'varchar', length: 20, default: FarmOperationStatus.DONE })
  status!: FarmOperationStatus;

  /** الموعد المخطط */
  @Column({ type: 'date', nullable: true })
  plannedDate?: string | null;

  /** من خطوة في التقويم الزراعي */
  @Column({ type: 'uuid', nullable: true })
  calendarStepId?: string | null;

  /** بداية التنفيذ الفعلي (وقت الجهاز في الميدان) */
  @Column({ type: 'timestamptz', nullable: true })
  performedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt?: Date | null;

  /** مدة التشغيل بالدقائق (ري: مدة فتح المحابس) */
  @Column({ type: 'int', nullable: true })
  durationMinutes?: number | null;

  /** كمية عامة للعملية (عذوق لُقّحت، فسائل فُصلت) ووحدتها */
  @Column(optionalQuantity)
  quantity?: number | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  quantityUnit?: string | null;

  /** م³ مياه (ري) */
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  waterM3?: number | null;

  @Column({ type: 'uuid', nullable: true })
  waterSourceId?: string | null;

  @ManyToOne(() => FarmWaterSource, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'waterSourceId' })
  waterSource?: FarmWaterSource | null;

  /** كم نبتة شملت (للتوزيع والمعدّل لكل نبتة) */
  @Column({ type: 'int', nullable: true })
  plantsCovered?: number | null;

  @Column(area)
  areaCoveredM2?: number | null;

  @Column({ type: 'int', nullable: true })
  workerCount?: number | null;

  /** مجموع ساعات العمل */
  @Column(hours)
  laborHours?: number | null;

  /** ساعات × تكلفة ساعة المزرعة وقت التنفيذ (لقطة) */
  @Column(money)
  laborCost!: number;

  /** قيمة المدخلات المصروفة (بتكلفة صرفها) */
  @Column(money)
  inputCost!: number;

  /** الآفة المستهدفة (رش) */
  @Column({ type: 'varchar', length: 30, nullable: true })
  targetPest?: string | null;

  /** لا يُحصد قبل هذا اليوم (فترة الأمان لأطول مبيد) */
  @Column({ type: 'date', nullable: true })
  harvestAllowedAt?: string | null;

  /** علاج لفحص آفة */
  @Column({ type: 'uuid', nullable: true })
  inspectionId?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt?: Date | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  cancelReason?: string | null;

  /** معرّف الجهاز الميداني (منع التكرار) */
  @Column({ type: 'uuid', nullable: true })
  clientUuid?: string | null;

  @Column({ type: 'uuid', nullable: true })
  recordedById?: string | null;

  /** اسم المشرف كما كُتب في الميدان */
  @Column({ type: 'varchar', length: 120, nullable: true })
  supervisorName?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @OneToMany(() => FarmOperationInput, (input) => input.operation)
  inputs?: FarmOperationInput[];

  @OneToMany(() => FarmOperationWorker, (worker) => worker.operation)
  workers?: FarmOperationWorker[];
}

/** مدخل صُرف للعملية من المخزن: سماد، مبيد، بذور، شتلات */
@Entity('farm_operation_inputs')
@Index(['operationId'])
@Index(['tenantId', 'productId'])
export class FarmOperationInput extends TenantOwnedEntity {
  @Column({ type: 'uuid' })
  operationId!: string;

  @ManyToOne(() => FarmOperation, (op) => op.inputs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'operationId' })
  operation?: FarmOperation;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouseId' })
  warehouse?: Warehouse;

  /** بوحدة أساس الصنف */
  @Column(quantity)
  quantity!: number;

  /** تكلفة الوحدة وقت الصرف (لقطة) */
  @Column({ ...quantity })
  unitCost!: number;

  @Column(money)
  totalCost!: number;

  /** فترة الأمان قبل الحصاد بالأيام (مبيد) */
  @Column({ type: 'int', nullable: true })
  phiDays?: number | null;
}

/** عامل على العملية: موظف مسجّل أو اسم كما كُتب في الميدان، وساعاته */
@Entity('farm_operation_workers')
@Index(['operationId'])
@Index(['tenantId', 'employeeId'])
export class FarmOperationWorker extends TenantOwnedEntity {
  @Column({ type: 'uuid' })
  operationId!: string;

  @ManyToOne(() => FarmOperation, (op) => op.workers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'operationId' })
  operation?: FarmOperation;

  @Column({ type: 'uuid', nullable: true })
  employeeId?: string | null;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column(hours)
  hours?: number | null;
}

/** نبتة بعينها شملتها العملية (لُقّحت، عولجت، فُصلت فسائلها) */
@Entity('farm_operation_plants')
@Index(['operationId', 'plantId'], { unique: true })
@Index(['plantId'])
export class FarmOperationPlant extends TenantOwnedEntity {
  @Column({ type: 'uuid' })
  operationId!: string;

  @ManyToOne(() => FarmOperation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'operationId' })
  operation?: FarmOperation;

  @Column({ type: 'uuid' })
  plantId!: string;

  @ManyToOne(() => FarmPlant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plantId' })
  plant?: FarmPlant;

  /** كمية خاصة بها (عذوق لُقّحت فيها) */
  @Column(optionalQuantity)
  quantity?: number | null;
}

export enum HarvestGrade {
  EXTRA = 'extra',
  FIRST = 'first',
  SECOND = 'second',
  THIRD = 'third',
  /** للتصنيع / علف */
  INDUSTRIAL = 'industrial',
}

/** لماذا رُفض جزء من الحصاد */
export enum HarvestRejectReason {
  PEST = 'pest',
  DISEASE = 'disease',
  DAMAGE = 'damage',
  OVERRIPE = 'overripe',
  UNDERRIPE = 'underripe',
  WEATHER = 'weather',
  /** فرز وتدريج */
  SORTING = 'sorting',
  OTHER = 'other',
}

export enum HarvestStatus {
  RECORDED = 'recorded',
  VOIDED = 'voided',
}

/** كيف قُيّم الحصاد عند دخوله المخزن */
export enum HarvestValuation {
  MANUAL = 'manual',
  STANDARD = 'standard',
  AVERAGE = 'average',
  ZERO = 'zero',
}

/**
 * حصاد دخل المخزن بدفعة: من أي وحدة وزراعة (ونخلة إن جُني نخلة نخلة)، وزنه
 * الصافي والقائم، جودته، ومرفوضه وسببه. يُلغى بحركة عكسية لا بتعديل.
 */
@Entity('farm_harvests')
@Index(['tenantId', 'number'], { unique: true })
@Index(['tenantId', 'clientUuid'], {
  unique: true,
  where: '"clientUuid" IS NOT NULL',
})
@Index(['tenantId', 'farmId', 'harvestedAt'])
@Index(['plantingId'])
@Index(['plantId'])
export class FarmHarvest extends TenantOwnedEntity {
  /** HRV-000001 */
  @Column({ type: 'varchar', length: 20 })
  number!: string;

  @Column({ type: 'uuid' })
  farmId!: string;

  @ManyToOne(() => Farm, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'farmId' })
  farm?: Farm;

  @Column({ type: 'uuid', nullable: true })
  unitId?: string | null;

  @ManyToOne(() => FarmUnit, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'unitId' })
  unit?: FarmUnit | null;

  @Column({ type: 'uuid', nullable: true })
  plantingId?: string | null;

  @ManyToOne(() => Planting, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'plantingId' })
  planting?: Planting | null;

  @Column({ type: 'uuid', nullable: true })
  plantId?: string | null;

  @ManyToOne(() => FarmPlant, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'plantId' })
  plant?: FarmPlant | null;

  @Column({ type: 'timestamptz' })
  harvestedAt!: Date;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouseId' })
  warehouse?: Warehouse;

  /** الصافي الذي دخل المخزن (وحدة أساس المنتج) */
  @Column(quantity)
  quantity!: number;

  /** القائم قبل الفرز والعبوات */
  @Column(optionalQuantity)
  grossQuantity?: number | null;

  /** عدد العذوق / الصناديق */
  @Column({ type: 'int', nullable: true })
  containers?: number | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  containerLabel?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  grade?: HarvestGrade | null;

  /** المرفوض (لا يدخل المخزن) */
  @Column(optionalQuantity)
  rejectQuantity?: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  rejectReason?: HarvestRejectReason | null;

  /** قيمة الوحدة عند الدخول (لقطة) وطريقتها */
  @Column({ ...quantity })
  unitCost!: number;

  @Column({ type: 'varchar', length: 10, default: HarvestValuation.ZERO })
  valuation!: HarvestValuation;

  @Column(money)
  value!: number;

  @Column({ type: 'varchar', length: 60 })
  lotNumber!: string;

  @Column({ type: 'int', nullable: true })
  workerCount?: number | null;

  @Column(hours)
  laborHours?: number | null;

  @Column(money)
  laborCost!: number;

  @Column({ type: 'varchar', length: 20, default: HarvestStatus.RECORDED })
  status!: HarvestStatus;

  @Column({ type: 'timestamptz', nullable: true })
  voidedAt?: Date | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  voidReason?: string | null;

  /** سُجّل قبل انتهاء فترة أمان مبيد على الوحدة (يُقبل ويُنبَّه) */
  @Column({ default: false })
  phiViolation!: boolean;

  @Column({ type: 'uuid', nullable: true })
  clientUuid?: string | null;

  @Column({ type: 'uuid', nullable: true })
  recordedById?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  supervisorName?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;
}

/** الآفات والأمراض الشائعة (والأخرى باسمها في pestName) */
export enum PestType {
  RED_PALM_WEEVIL = 'red_palm_weevil',
  DUBAS_BUG = 'dubas_bug',
  LESSER_DATE_MOTH = 'lesser_date_moth',
  DATE_SPIDER_MITE = 'date_spider_mite',
  SCALE_INSECT = 'scale_insect',
  LONGHORN_BORER = 'longhorn_borer',
  TERMITES = 'termites',
  BAYOUD = 'bayoud',
  BLACK_SCORCH = 'black_scorch',
  INFLORESCENCE_ROT = 'inflorescence_rot',
  APHIDS = 'aphids',
  WHITEFLY = 'whitefly',
  THRIPS = 'thrips',
  LEAF_MINER = 'leaf_miner',
  FRUIT_FLY = 'fruit_fly',
  POWDERY_MILDEW = 'powdery_mildew',
  DOWNY_MILDEW = 'downy_mildew',
  ROOT_ROT = 'root_rot',
  VIRAL = 'viral',
  NEMATODES = 'nematodes',
  WEEDS = 'weeds',
  RODENTS = 'rodents',
  BIRDS = 'birds',
  LOCUST = 'locust',
  NUTRIENT_DEFICIENCY = 'nutrient_deficiency',
  OTHER = 'other',
}

export enum InspectionStatus {
  OPEN = 'open',
  TREATING = 'treating',
  RESOLVED = 'resolved',
}

/**
 * فحص آفة أو مرض: أين ومتى وكم شدته وكم نبتة أصيبت من كم فُحصت. يبقى مفتوحاً
 * حتى يُعالج ويُغلق — والنخلة المصابة تُعلَّم في السجل.
 */
@Entity('farm_inspections')
@Index(['tenantId', 'number'], { unique: true })
@Index(['tenantId', 'clientUuid'], {
  unique: true,
  where: '"clientUuid" IS NOT NULL',
})
@Index(['tenantId', 'farmId', 'status'])
@Index(['plantId'])
export class FarmInspection extends TenantOwnedEntity {
  /** INS-000001 */
  @Column({ type: 'varchar', length: 20 })
  number!: string;

  @Column({ type: 'uuid' })
  farmId!: string;

  @ManyToOne(() => Farm, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'farmId' })
  farm?: Farm;

  @Column({ type: 'uuid', nullable: true })
  unitId?: string | null;

  @ManyToOne(() => FarmUnit, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'unitId' })
  unit?: FarmUnit | null;

  @Column({ type: 'uuid', nullable: true })
  plantingId?: string | null;

  @ManyToOne(() => Planting, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'plantingId' })
  planting?: Planting | null;

  @Column({ type: 'uuid', nullable: true })
  plantId?: string | null;

  @ManyToOne(() => FarmPlant, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'plantId' })
  plant?: FarmPlant | null;

  @Column({ type: 'timestamptz' })
  inspectedAt!: Date;

  @Column({ type: 'varchar', length: 30 })
  pest!: PestType;

  /** اسم الآفة إن كانت "أخرى" أو للتفصيل */
  @Column({ type: 'varchar', length: 120, nullable: true })
  pestName?: string | null;

  /** 0 لا شيء، 1 خفيفة، 2 متوسطة، 3 شديدة، 4 حرجة */
  @Column({ type: 'int' })
  severity!: number;

  /** كم نبتة مصابة، ومن كم فُحصت (نسبة الإصابة) */
  @Column({ type: 'int', nullable: true })
  affectedCount?: number | null;

  @Column({ type: 'int', nullable: true })
  sampledCount?: number | null;

  @Column({ type: 'varchar', length: 20, default: InspectionStatus.OPEN })
  status!: InspectionStatus;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  treatmentOperationId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  clientUuid?: string | null;

  @Column({ type: 'uuid', nullable: true })
  recordedById?: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  inspectorName?: string | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;
}

export enum FarmTransactionKind {
  /** صرف مدخلات: من المخزون إلى تكاليف الإنتاج الزراعي */
  INPUT = 'input',
  INPUT_REVERSAL = 'input_reversal',
  /** حصاد: إلى المخزون من الإنتاج الزراعي المحمّل */
  HARVEST = 'harvest',
  HARVEST_REVERSAL = 'harvest_reversal',
}

/** حدث مخزني بقيمته على عملية أو حصاد: منه يُرحَّل القيد */
@Entity('farm_transactions')
@Index(['tenantId', 'occurredAt'])
@Index(['sourceType', 'sourceId'])
export class FarmTransaction extends TenantOwnedEntity {
  @Column({ type: 'uuid' })
  farmId!: string;

  @ManyToOne(() => Farm, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'farmId' })
  farm?: Farm;

  /** operation | harvest */
  @Column({ type: 'varchar', length: 20 })
  sourceType!: 'operation' | 'harvest';

  @Column({ type: 'uuid' })
  sourceId!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: FarmTransactionKind;

  /** بالموجب دائماً، والاتجاه من النوع */
  @Column(money)
  value!: number;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  reference?: string | null;

  @Column({ type: 'timestamptz' })
  occurredAt!: Date;
}
