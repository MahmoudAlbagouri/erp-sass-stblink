// src/modules/farms/entities/planting.entity.ts
//
// الزراعة: محصول على وحدة من المزرعة لمدة — صف نخيل سكري غُرس 2015، بلوك زيتون
// فيه 500 شجرة، حقل قمح موسم 2026/2027، صوبة طماطم دورة الربيع. تُتابع:
//   individual  كل نخلة/شجرة سجل مستقل (وسمها، موقعها في الصف، جنسها، حالتها)
//   count       بالعدد في الوحدة
//   area        بالمساحة (المحاصيل الحقلية والخضار)
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';
import { Crop, CropVariety } from './crop.entity';
import { DatePrecision, PlantingTrackingMode } from './farm-enums';
import { area, coordinate, Farm, FarmUnit } from './farm.entity';

export enum PlantingStatus {
  PLANNED = 'planned',
  ACTIVE = 'active',
  CLOSED = 'closed',
  FAILED = 'failed',
}

/** لماذا انتهت الزراعة: أساس تحليل الفشل والمخاطر */
export enum PlantingEndReason {
  /** اكتمل حصادها */
  COMPLETED = 'completed',
  CROP_FAILURE = 'crop_failure',
  PEST = 'pest',
  DISEASE = 'disease',
  FROST = 'frost',
  HEAT = 'heat',
  DROUGHT = 'drought',
  FLOOD = 'flood',
  SALINITY = 'salinity',
  /** قُلعت لإعادة الزراعة أو تغيير الاستخدام */
  REMOVED = 'removed',
  OTHER = 'other',
}

@Entity('plantings')
@Index(['tenantId', 'number'], { unique: true })
@Index(['tenantId', 'farmId', 'status'])
@Index(['unitId'])
export class Planting extends TenantOwnedEntity {
  /** PLT-000001 */
  @Column({ type: 'varchar', length: 20 })
  number!: string;

  @Column({ type: 'uuid' })
  farmId!: string;

  @ManyToOne(() => Farm, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'farmId' })
  farm?: Farm;

  @Column({ type: 'uuid' })
  unitId!: string;

  @ManyToOne(() => FarmUnit, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'unitId' })
  unit?: FarmUnit;

  @Column({ type: 'uuid' })
  cropId!: string;

  @ManyToOne(() => Crop, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cropId' })
  crop?: Crop;

  @Column({ type: 'uuid', nullable: true })
  varietyId?: string | null;

  @ManyToOne(() => CropVariety, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'varietyId' })
  variety?: CropVariety | null;

  @Column({ type: 'varchar', length: 20 })
  trackingMode!: PlantingTrackingMode;

  /** عدد النباتات القائمة (individual: يُحدَّث من السجل) */
  @Column({ type: 'int', default: 0 })
  plantCount!: number;

  @Column(area)
  areaM2?: number | null;

  /** تاريخ الزرع/الغرس (المخطط حتى تبدأ) */
  @Column({ type: 'date', nullable: true })
  plantedAt?: string | null;

  @Column({ type: 'varchar', length: 10, default: DatePrecision.DAY })
  plantedAtPrecision!: DatePrecision;

  /** "2026/2027"، "ربيع 2026" */
  @Column({ type: 'varchar', length: 30, nullable: true })
  season?: string | null;

  /** الحصاد المتوقع (حولي) */
  @Column({ type: 'date', nullable: true })
  expectedHarvestAt?: string | null;

  /** الإنتاج المتوقع للموسم/الدورة بوحدة أساس منتج الحصاد — المخطط */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 3,
    nullable: true,
    transformer: decimalTransformer,
  })
  expectedYield?: number | null;

  @Column({ type: 'varchar', length: 20, default: PlantingStatus.ACTIVE })
  status!: PlantingStatus;

  /** متى بدأت فعلاً (planned ← active) */
  @Column({ type: 'timestamptz', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'date', nullable: true })
  closedAt?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  closeReason?: PlantingEndReason | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;
}

export enum PlantSex {
  FEMALE = 'female',
  MALE = 'male',
  UNKNOWN = 'unknown',
}

/** من أين جاءت النبتة */
export enum PlantSource {
  /** فسيلة من نخلة أم */
  OFFSHOOT = 'offshoot',
  TISSUE_CULTURE = 'tissue_culture',
  SEEDLING = 'seedling',
  SEED = 'seed',
  NURSERY = 'nursery',
  /** موجودة قبل النظام */
  EXISTING = 'existing',
  OTHER = 'other',
}

export enum PlantStatus {
  HEALTHY = 'healthy',
  /** مصابة بآفة (سوسة النخيل...) */
  INFESTED = 'infested',
  DISEASED = 'diseased',
  WEAK = 'weak',
  DEAD = 'dead',
  REMOVED = 'removed',
}

export enum PlantRemovalReason {
  DEAD = 'dead',
  PEST = 'pest',
  DISEASE = 'disease',
  REPLACED = 'replaced',
  TRANSPLANTED = 'transplanted',
  STORM = 'storm',
  SALINITY = 'salinity',
  /** ذكر زائد عن الحاجة */
  EXCESS_MALE = 'excess_male',
  OTHER = 'other',
}

/** الحالات التي لم تعد فيها النبتة قائمة */
export const GONE_PLANT_STATUSES: readonly PlantStatus[] = [
  PlantStatus.DEAD,
  PlantStatus.REMOVED,
];

/**
 * نخلة أو شجرة في السجل (زراعة individual). وسمها فريد في المزرعة ومكتوب
 * عليها (لوحة أو QR)، وموقعها رقمها في الصف.
 */
@Entity('farm_plants')
@Index(['farmId', 'tag'], { unique: true, where: '"deletedAt" IS NULL' })
@Index(['plantingId'])
@Index(['unitId', 'position'])
export class FarmPlant extends TenantOwnedEntity {
  @Column({ type: 'uuid' })
  farmId!: string;

  @ManyToOne(() => Farm, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'farmId' })
  farm?: Farm;

  @Column({ type: 'uuid' })
  plantingId!: string;

  @ManyToOne(() => Planting, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plantingId' })
  planting?: Planting;

  /** الصف أو الحوش الذي تقف فيه (من شجرة وحدة الزراعة) */
  @Column({ type: 'uuid' })
  unitId!: string;

  @ManyToOne(() => FarmUnit, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'unitId' })
  unit?: FarmUnit;

  @Column({ type: 'varchar', length: 40 })
  tag!: string;

  /** رقمها في الصف */
  @Column({ type: 'int', nullable: true })
  position?: number | null;

  @Column({ type: 'varchar', length: 10, default: PlantSex.UNKNOWN })
  sex!: PlantSex;

  @Column({ type: 'date', nullable: true })
  plantedAt?: string | null;

  @Column({ type: 'varchar', length: 10, default: DatePrecision.DAY })
  plantedAtPrecision!: DatePrecision;

  @Column({ type: 'varchar', length: 20, default: PlantSource.EXISTING })
  source!: PlantSource;

  /** النخلة الأم (فسيلة) */
  @Column({ type: 'uuid', nullable: true })
  motherPlantId?: string | null;

  @ManyToOne(() => FarmPlant, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'motherPlantId' })
  motherPlant?: FarmPlant | null;

  /** حلّت محل نبتة ماتت أو قُلعت في نفس الموقع */
  @Column({ type: 'uuid', nullable: true })
  replacesPlantId?: string | null;

  @Column({ type: 'varchar', length: 20, default: PlantStatus.HEALTHY })
  status!: PlantStatus;

  @Column({ type: 'timestamptz', nullable: true })
  statusChangedAt?: Date | null;

  @Column({ type: 'date', nullable: true })
  removedAt?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  removalReason?: PlantRemovalReason | null;

  @Column(coordinate)
  latitude?: number | null;

  @Column(coordinate)
  longitude?: number | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;
}

/** تاريخ حالات النبتة: متى أُصيبت ومتى تعافت أو ماتت، ولماذا ومن أين عُرف */
@Entity('farm_plant_status_logs')
@Index(['plantId', 'occurredAt'])
export class FarmPlantStatusLog extends TenantOwnedEntity {
  @Column({ type: 'uuid' })
  plantId!: string;

  @ManyToOne(() => FarmPlant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plantId' })
  plant?: FarmPlant;

  @Column({ type: 'varchar', length: 20, nullable: true })
  fromStatus?: PlantStatus | null;

  @Column({ type: 'varchar', length: 20 })
  toStatus!: PlantStatus;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reason?: string | null;

  /** inspection | operation | manual | field */
  @Column({ type: 'varchar', length: 20 })
  sourceType!: string;

  @Column({ type: 'uuid', nullable: true })
  sourceId?: string | null;

  @Column({ type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ type: 'uuid', nullable: true })
  userId?: string | null;
}
