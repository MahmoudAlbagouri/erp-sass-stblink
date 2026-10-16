// src/modules/inventory/entities/stocktake.entity.ts
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';
import { Product } from '../../catalog/entities/product.entity';
import { Warehouse } from './warehouse.entity';

export enum StocktakeStatus {
  /** جارٍ العدّ: الأرصدة لم تتغير بعد */
  DRAFT = 'draft',
  /** اعتُمد: سُوّيت الأرصدة على الكميات المعدودة */
  POSTED = 'posted',
  CANCELLED = 'cancelled',
}

/** جرد مخزن: عدّ فعلي لأصناف، وعند الاعتماد يُسوّى الرصيد على المعدود */
@Entity('stocktakes')
@Index(['tenantId', 'number'], { unique: true })
@Index(['tenantId', 'status'])
export class Stocktake extends TenantOwnedEntity {
  /** ST-000001 — تسلسلي داخل الشركة */
  @Column({ type: 'varchar', length: 20 })
  number!: string;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouseId' })
  warehouse?: Warehouse;

  @Column({
    type: 'enum',
    enum: StocktakeStatus,
    default: StocktakeStatus.DRAFT,
  })
  status!: StocktakeStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  postedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  postedById?: string | null;

  @OneToMany(() => StocktakeLine, (line) => line.stocktake)
  lines?: StocktakeLine[];

  /** ليس عموداً: عدد الأصناف، يُملأ في قائمة الجرد */
  linesCount?: number;
}

@Entity('stocktake_lines')
@Index(['stocktakeId', 'productId'], { unique: true })
export class StocktakeLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  stocktakeId!: string;

  @ManyToOne(() => Stocktake, (stocktake) => stocktake.lines, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'stocktakeId' })
  stocktake?: Stocktake;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  /** الكمية المعدودة فعلياً */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    transformer: decimalTransformer,
  })
  countedQuantity!: number;

  /**
   * متى عُدّ آخر مرة (وقت الجهاز في شاشة العدّ). عدّان لنفس الصنف من جهازين:
   * الأحدث يكسب ولو وصل أولاً. null = سطر قديم قبل شاشة العدّ.
   */
  @Column({ type: 'timestamptz', nullable: true })
  countedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  countedById?: string | null;

  /** رصيد النظام لحظة الاعتماد (null قبل الاعتماد) */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    nullable: true,
    transformer: decimalTransformer,
  })
  expectedQuantity?: number | null;

  /** متوسط التكلفة لحظة الاعتماد — لتقييم الفرق (عجز/زيادة) بالمال */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: decimalTransformer,
  })
  unitCost!: number;

  /** ليس عموداً: رصيد النظام الحالي، يُملأ عند عرض مسودة */
  currentQuantity?: number;
}
