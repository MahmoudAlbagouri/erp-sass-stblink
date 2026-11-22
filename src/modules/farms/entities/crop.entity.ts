// src/modules/farms/entities/crop.entity.ts
//
// المحاصيل وأصنافها: نخيل (برحي، سكري، خلاص...)، أشجار فاكهة، محاصيل حقلية،
// خضار، أعلاف، زراعات الصوب. الصنف يحدد منتج الحصاد في المخزن، وتكلفته
// المعيارية، والإنتاجية المتوقعة (المخطط مقابل الفعلي).
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
import { FarmOperationType, PlantingTrackingMode } from './farm-enums';

export enum CropCategory {
  PALM = 'palm',
  FRUIT_TREE = 'fruit_tree',
  FIELD_CROP = 'field_crop',
  VEGETABLE = 'vegetable',
  FORAGE = 'forage',
  /** زراعات الصوب */
  GREENHOUSE = 'greenhouse',
  ORNAMENTAL = 'ornamental',
  OTHER = 'other',
}

/** معمّر (أشجار ونخيل: يُحصد كل موسم) أم حولي (دورة تنتهي بحصادها) */
export enum CropLifecycle {
  PERENNIAL = 'perennial',
  ANNUAL = 'annual',
}

const yieldColumn = {
  type: 'numeric' as const,
  precision: 14,
  scale: 3,
  nullable: true,
  transformer: decimalTransformer,
};

@Entity('crops')
@Index(['tenantId', 'name'], { unique: true, where: '"deletedAt" IS NULL' })
export class Crop extends TenantOwnedEntity {
  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 20 })
  category!: CropCategory;

  @Column({ type: 'varchar', length: 20 })
  lifecycle!: CropLifecycle;

  /** طريقة المتابعة المقترحة لزراعاته الجديدة */
  @Column({ type: 'varchar', length: 20, default: PlantingTrackingMode.COUNT })
  defaultTrackingMode!: PlantingTrackingMode;

  /** منتج الحصاد الافتراضي (صنف مخزني) — للصنف أن يغيّره */
  @Column({ type: 'uuid', nullable: true })
  harvestProductId?: string | null;

  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'harvestProductId' })
  harvestProduct?: Product | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ default: true })
  isActive!: boolean;

  @OneToMany(() => CropVariety, (variety) => variety.crop)
  varieties?: CropVariety[];
}

@Entity('crop_varieties')
@Index(['cropId', 'name'], { unique: true, where: '"deletedAt" IS NULL' })
export class CropVariety extends TenantOwnedEntity {
  @Column({ type: 'uuid' })
  cropId!: string;

  @ManyToOne(() => Crop, (crop) => crop.varieties, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cropId' })
  crop?: Crop;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /** منتج حصاد هذا الصنف (تمر سكري) — null = منتج المحصول */
  @Column({ type: 'uuid', nullable: true })
  harvestProductId?: string | null;

  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'harvestProductId' })
  harvestProduct?: Product | null;

  /**
   * التكلفة المعيارية لوحدة أساس منتج الحصاد: بها يدخل الحصاد المخزن إن لم
   * تُكتب قيمته. null = متوسط تكلفة المنتج الحالي (أو صفر).
   */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    nullable: true,
    transformer: decimalTransformer,
  })
  standardCost?: number | null;

  /** المتوقع للنبتة في الموسم (معمّر) بوحدة أساس منتج الحصاد */
  @Column(yieldColumn)
  expectedYieldPerPlant?: number | null;

  /** المتوقع للهكتار في الدورة (حولي) */
  @Column(yieldColumn)
  expectedYieldPerHectare?: number | null;

  /** من الزرع للحصاد بالأيام (حولي) */
  @Column({ type: 'int', nullable: true })
  daysToHarvest?: number | null;

  /** من الغرس لأول إثمار بالسنوات (معمّر) */
  @Column({ type: 'int', nullable: true })
  yearsToBearing?: number | null;

  /** أشهر الجني المعتادة (7 = يوليو) */
  @Column({ type: 'jsonb', nullable: true })
  harvestMonths?: number[] | null;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ default: true })
  isActive!: boolean;
}

/**
 * خطوة في التقويم الزراعي: عملية تُخطَّط تلقائياً. للحولي بعد الزرع بأيام
 * (`planting`)، وللمعمّر في شهر ويوم من كل سنة (`yearly`: التلقيح في مارس).
 */
@Entity('crop_calendar_steps')
@Index(['tenantId', 'cropId'])
export class CropCalendarStep extends TenantOwnedEntity {
  @Column({ type: 'uuid' })
  cropId!: string;

  @ManyToOne(() => Crop, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cropId' })
  crop?: Crop;

  /** null = لكل أصناف المحصول */
  @Column({ type: 'uuid', nullable: true })
  varietyId?: string | null;

  @ManyToOne(() => CropVariety, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'varietyId' })
  variety?: CropVariety | null;

  @Column({ type: 'varchar', length: 30 })
  operationType!: FarmOperationType;

  @Column({ type: 'varchar', length: 150 })
  title!: string;

  /** planting | yearly */
  @Column({ type: 'varchar', length: 10 })
  anchor!: 'planting' | 'yearly';

  /** بعد الزرع بكم يوم (planting) */
  @Column({ type: 'int', nullable: true })
  dayOffset?: number | null;

  /** الشهر واليوم (yearly) */
  @Column({ type: 'int', nullable: true })
  month?: number | null;

  @Column({ type: 'int', nullable: true })
  day?: number | null;

  /** تتكرر كل كم يوم داخل الموسم (ري كل 3 أيام) — null = مرة */
  @Column({ type: 'int', nullable: true })
  repeatEveryDays?: number | null;

  /** عدد مرات التكرار */
  @Column({ type: 'int', nullable: true })
  repeatCount?: number | null;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;
}
