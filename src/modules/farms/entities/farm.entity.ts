// src/modules/farms/entities/farm.entity.ts
//
// المزرعة (الأرض) وشجرة تقسيمها: كل مزرعة تُقسَّم كما يقسّمها أصحابها فعلاً —
// قطاع ← حوش ← صف، أو حقل ← مصطبة، أو صوبة — بلا مستويات مفروضة. لكل وحدة
// حدودها على الخريطة (مضلع) ومساحتها وتربتها وطريقة ريّها.
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
import { Branch } from '../../branches/entities/branch.entity';
import { Warehouse } from '../../inventory/entities/warehouse.entity';

/** حلقة مضلع: نقاط [خط الطول، خط العرض] بترتيب الرسم (GeoJSON) */
export type GeoRing = [number, number][];

export const area = {
  type: 'numeric' as const,
  precision: 14,
  scale: 2,
  nullable: true,
  transformer: decimalTransformer,
};
export const coordinate = {
  type: 'numeric' as const,
  precision: 9,
  scale: 6,
  nullable: true,
  transformer: decimalTransformer,
};

export enum FarmOwnership {
  OWNED = 'owned',
  LEASED = 'leased',
  PARTNERSHIP = 'partnership',
  OTHER = 'other',
}

/** نوع وحدة في شجرة المزرعة: الاسم المعروض والمكان في الخريطة */
export enum FarmUnitKind {
  SECTOR = 'sector',
  /** الحوش: قطعة مسوّرة أو بلوك داخل القطاع */
  BLOCK = 'block',
  ROW = 'row',
  FIELD = 'field',
  /** صوبة / بيت محمي */
  GREENHOUSE = 'greenhouse',
  /** مصطبة أو خط داخل الحقل أو الصوبة */
  BED = 'bed',
  /** مشتل */
  NURSERY = 'nursery',
  OTHER = 'other',
}

export enum SoilType {
  SANDY = 'sandy',
  LOAMY_SAND = 'loamy_sand',
  LOAM = 'loam',
  CLAY = 'clay',
  SILT = 'silt',
  SALINE = 'saline',
  CALCAREOUS = 'calcareous',
  OTHER = 'other',
}

export enum IrrigationMethod {
  DRIP = 'drip',
  BUBBLER = 'bubbler',
  SPRINKLER = 'sprinkler',
  PIVOT = 'pivot',
  FLOOD = 'flood',
  MANUAL = 'manual',
  NONE = 'none',
}

export enum WaterSourceKind {
  WELL = 'well',
  NETWORK = 'network',
  CANAL = 'canal',
  TANK = 'tank',
  DESALINATION = 'desalination',
  RAINWATER = 'rainwater',
  OTHER = 'other',
}

/**
 * المزرعة: أرض واحدة لها مخزن تُصرف منه مدخلاتها ويدخله حصادها، وفرعه فرع
 * المزرعة. حدودها مضلع على الخريطة، ومساحتها منه أو مكتوبة.
 */
@Entity('farms')
@Index(['tenantId', 'code'], { unique: true, where: '"deletedAt" IS NULL' })
@Index(['tenantId', 'name'], { unique: true, where: '"deletedAt" IS NULL' })
export class Farm extends TenantOwnedEntity {
  /** FRM-000001 */
  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'uuid', nullable: true })
  branchId?: string | null;

  @ManyToOne(() => Branch, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'branchId' })
  branch?: Branch | null;

  /** المخزن الافتراضي للمدخلات والحصاد */
  @Column({ type: 'uuid', nullable: true })
  warehouseId?: string | null;

  @ManyToOne(() => Warehouse, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'warehouseId' })
  warehouse?: Warehouse | null;

  @Column({ type: 'varchar', length: 20, default: FarmOwnership.OWNED })
  ownership!: FarmOwnership;

  /** نهاية عقد الإيجار (للمستأجرة) */
  @Column({ type: 'date', nullable: true })
  leaseEndsOn?: string | null;

  @Column({ type: 'varchar', length: 250, nullable: true })
  address?: string | null;

  /** نقطة المزرعة (المدخل أو المركز) */
  @Column(coordinate)
  latitude?: number | null;

  @Column(coordinate)
  longitude?: number | null;

  @Column({ type: 'jsonb', nullable: true })
  boundary?: GeoRing | null;

  /** م² — من الحدود إن رُسمت، أو مكتوبة */
  @Column(area)
  areaM2?: number | null;

  /**
   * تكلفة ساعة العامل لتقارير التكلفة (الأجر الفعلي يُرحَّل من الرواتب؛ هذا
   * لتوزيعه على العمليات فقط). null = لا تُحسب العمالة في التكلفة.
   */
  @Column({
    type: 'numeric',
    precision: 13,
    scale: 3,
    nullable: true,
    transformer: decimalTransformer,
  })
  laborHourCost?: number | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ default: true })
  isActive!: boolean;

  @OneToMany(() => FarmUnit, (unit) => unit.farm)
  units?: FarmUnit[];
}

/**
 * وحدة في شجرة المزرعة. `path` معرّفات الأجداد ثم الوحدة نفسها مفصولة بـ "/"
 * فتُجلب الشجرة الفرعية بشرط واحد (`path LIKE 'جد/%'`).
 */
@Entity('farm_units')
@Index(['tenantId', 'farmId'])
@Index(['farmId', 'parentId', 'name'], {
  unique: true,
  where: '"deletedAt" IS NULL',
})
export class FarmUnit extends TenantOwnedEntity {
  @Column({ type: 'uuid' })
  farmId!: string;

  @ManyToOne(() => Farm, (farm) => farm.units, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'farmId' })
  farm?: Farm;

  /** null = تحت المزرعة مباشرة */
  @Column({ type: 'uuid', nullable: true })
  parentId?: string | null;

  @ManyToOne(() => FarmUnit, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parentId' })
  parent?: FarmUnit | null;

  @Column({ type: 'varchar', length: 20 })
  kind!: FarmUnitKind;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /** كود قصير يظهر على الخريطة وفي وسم الشجرة (A، 3، R12) */
  @Column({ type: 'varchar', length: 20, nullable: true })
  code?: string | null;

  @Column({ type: 'text' })
  path!: string;

  /** 1 = تحت المزرعة مباشرة */
  @Column({ type: 'int' })
  depth!: number;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'jsonb', nullable: true })
  boundary?: GeoRing | null;

  @Column(area)
  areaM2?: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  soilType?: SoilType | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  irrigationMethod?: IrrigationMethod | null;

  /**
   * كل كم يوم تُروى (للتنبيه "محتاج ري" على الخريطة). null = يُورَث من الأب،
   * ولا أب له = لا تنبيه.
   */
  @Column({ type: 'int', nullable: true })
  irrigationIntervalDays?: number | null;

  /** عدد الجور أو المواقع المخططة (صف فيه 40 جورة) */
  @Column({ type: 'int', nullable: true })
  plannedPositions?: number | null;

  @Column({ type: 'uuid', nullable: true })
  waterSourceId?: string | null;

  @ManyToOne(() => FarmWaterSource, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'waterSourceId' })
  waterSource?: FarmWaterSource | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ default: true })
  isActive!: boolean;
}

/** مصدر مياه: بئر، شبكة، خزان... بطاقته (م³/ساعة) — طاقة الري */
@Entity('farm_water_sources')
@Index(['tenantId', 'farmId'])
export class FarmWaterSource extends TenantOwnedEntity {
  @Column({ type: 'uuid' })
  farmId!: string;

  @ManyToOne(() => Farm, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'farmId' })
  farm?: Farm;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: WaterSourceKind;

  /** م³ في الساعة */
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  capacityM3PerHour?: number | null;

  /** عمق البئر بالمتر */
  @Column({
    type: 'numeric',
    precision: 8,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  depthM?: number | null;

  /** ملوحة المياه (جزء في المليون) */
  @Column({ type: 'int', nullable: true })
  salinityPpm?: number | null;

  @Column(coordinate)
  latitude?: number | null;

  @Column(coordinate)
  longitude?: number | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ default: true })
  isActive!: boolean;
}

/** طقس يوم في المزرعة: لا يُسترجع بعد مروره، ومنه يُفسَّر تذبذب الإنتاج */
@Entity('farm_weather_logs')
@Index(['farmId', 'date'], { unique: true, where: '"deletedAt" IS NULL' })
export class FarmWeatherLog extends TenantOwnedEntity {
  @Column({ type: 'uuid' })
  farmId!: string;

  @ManyToOne(() => Farm, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'farmId' })
  farm?: Farm;

  @Column({ type: 'date' })
  date!: string;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 1,
    nullable: true,
    transformer: decimalTransformer,
  })
  tempMin?: number | null;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 1,
    nullable: true,
    transformer: decimalTransformer,
  })
  tempMax?: number | null;

  @Column({
    type: 'numeric',
    precision: 6,
    scale: 1,
    nullable: true,
    transformer: decimalTransformer,
  })
  rainMm?: number | null;

  /** الرطوبة % */
  @Column({ type: 'int', nullable: true })
  humidity?: number | null;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 1,
    nullable: true,
    transformer: decimalTransformer,
  })
  windKmh?: number | null;

  /** صقيع */
  @Column({ default: false })
  frost!: boolean;

  /** عاصفة رملية / غبار */
  @Column({ default: false })
  dustStorm!: boolean;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;
}
