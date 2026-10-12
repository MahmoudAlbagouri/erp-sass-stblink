// src/modules/inventory/entities/stock-level.entity.ts
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';
import { Product } from '../../catalog/entities/product.entity';
import { InventoryItem } from './inventory-item.entity';
import { Warehouse } from './warehouse.entity';

/**
 * الرصيد الحالي لصنف في مخزن (بوحدة الأساس).
 *
 * قيمة مشتقة من دفتر الحركات (stock_movements) — لا تُعدَّل أبداً مباشرة،
 * بل عبر StockService.apply الذي يكتب الحركة والرصيد في نفس المعاملة.
 */
@Entity('stock_levels')
@Index(['warehouseId', 'productId'], { unique: true })
@Index(['tenantId', 'productId'])
export class StockLevel {
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

  // علاقة للقراءة فقط (اسم الصنف وكوده في القوائم) — الكتابة على الأصناف
  // تبقى حكراً على موديول الأصناف
  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: decimalTransformer,
  })
  quantity!: number;

  /** حد إعادة الطلب: تحته يظهر الصنف في تنبيه "رصيد منخفض" (اختياري) */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    nullable: true,
    transformer: decimalTransformer,
  })
  minQuantity?: number | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  /** ليس عموداً: يُملأ في استعلام الأرصدة (متوسط التكلفة لتقييم الرصيد) */
  item?: InventoryItem | null;
}
