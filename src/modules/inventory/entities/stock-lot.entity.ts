// src/modules/inventory/entities/stock-lot.entity.ts
//
// الدفعات (lots / batches) وتواريخ الانتهاء — لأصناف trackLots وحدها.
//
//   stock_lots           الدفعة نفسها: رقمها، انتهاؤها، تاريخ إنتاجها، ومصدرها
//   stock_lot_levels     رصيد كل دفعة في كل مخزن
//   stock_movement_lots  توزيع كل حركة مخزون على الدفعات (أساس التتبع)
//
// رصيد الصنف في المخزن يبقى في stock_levels كما هو؛ ما لا يغطيه مجموع دفعاته =
// "غير معيّن" (رصيد قبل تفعيل التتبع، أو بيع تجاوز الدفعات). دفتر الحركات لا
// يتغير: التوزيع جدول بجانبه، فلا يتأثر أي تقرير قائم.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';
import { Product } from '../../catalog/entities/product.entity';
import { StockMovement } from './stock-movement.entity';
import { Warehouse } from './warehouse.entity';

const quantity = {
  type: 'numeric' as const,
  precision: 14,
  scale: 4,
  transformer: decimalTransformer,
};

/** من أين جاءت الدفعة أول مرة */
export enum StockLotSource {
  PURCHASE = 'purchase',
  PRODUCTION = 'production',
  ADJUSTMENT = 'adjustment',
  OPENING = 'opening',
  OTHER = 'other',
}

@Entity('stock_lots')
@Index(['tenantId', 'productId', 'lotNumber'], { unique: true })
@Index(['tenantId', 'expiryDate'])
export class StockLot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  /** رقم الدفعة كما على العبوة أو كما ولّده أمر الإنتاج — فريد للصنف */
  @Column({ type: 'varchar', length: 60 })
  lotNumber!: string;

  /** تاريخ الانتهاء (null = لا ينتهي) */
  @Column({ type: 'date', nullable: true })
  expiryDate?: string | null;

  @Column({ type: 'date', nullable: true })
  manufactureDate?: string | null;

  @Column({ type: 'varchar', length: 20, default: StockLotSource.OTHER })
  source!: StockLotSource;

  /** المستند الذي أدخلها أول مرة (فاتورة شراء، أمر إنتاج...) */
  @Column({ type: 'varchar', length: 40, nullable: true })
  sourceType?: string | null;

  @Column({ type: 'uuid', nullable: true })
  sourceId?: string | null;

  /** المورد (للمشتراة): لتتبع السحب عند المورد */
  @Column({ type: 'uuid', nullable: true })
  supplierId?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity('stock_lot_levels')
@Index(['warehouseId', 'lotId'], { unique: true })
@Index(['tenantId', 'productId'])
export class StockLotLevel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @ManyToOne(() => Warehouse, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'warehouseId' })
  warehouse?: Warehouse;

  @Column({ type: 'uuid' })
  productId!: string;

  @Column({ type: 'uuid' })
  lotId!: string;

  @ManyToOne(() => StockLot, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lotId' })
  lot?: StockLot;

  /** بوحدة الأساس، لا يقل عن صفر */
  @Column({ ...quantity, default: 0 })
  quantity!: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * نصيب كل دفعة من حركة مخزون: موجبة دخول وسالبة خروج، ومجموعها = كمية
 * الحركة. lotId = null للجزء غير المعيّن.
 */
@Entity('stock_movement_lots')
@Index(['movementId'])
@Index(['tenantId', 'lotId'])
export class StockMovementLot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  movementId!: string;

  @ManyToOne(() => StockMovement, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'movementId' })
  movement?: StockMovement;

  @Column({ type: 'uuid', nullable: true })
  lotId?: string | null;

  @ManyToOne(() => StockLot, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'lotId' })
  lot?: StockLot | null;

  @Column(quantity)
  quantity!: number;
}
