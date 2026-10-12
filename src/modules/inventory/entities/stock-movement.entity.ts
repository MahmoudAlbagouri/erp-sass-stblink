// src/modules/inventory/entities/stock-movement.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';
import { Product } from '../../catalog/entities/product.entity';
import { Warehouse } from './warehouse.entity';

export enum StockMovementType {
  OPENING = 'opening',
  PURCHASE = 'purchase',
  PURCHASE_RETURN = 'purchase_return',
  SALE = 'sale',
  SALE_RETURN = 'sale_return',
  TRANSFER_OUT = 'transfer_out',
  TRANSFER_IN = 'transfer_in',
  ADJUSTMENT = 'adjustment',
  STOCKTAKE = 'stocktake',
}

/**
 * دفتر حركات المخزون — سجل لا يُعدَّل ولا يُحذف.
 * كل تغيير في أي رصيد له سطر هنا، وتصحيح الخطأ يكون بحركة عكسية لا بتعديل
 * القديمة. بذلك يمكن دائماً معرفة "لماذا الرصيد هكذا؟".
 */
@Entity('stock_movements')
@Index(['tenantId', 'productId', 'occurredAt'])
@Index(['tenantId', 'warehouseId', 'occurredAt'])
@Index(['tenantId', 'referenceType', 'referenceId'])
export class StockMovement {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouseId' })
  warehouse?: Warehouse;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  @Column({ type: 'enum', enum: StockMovementType })
  type!: StockMovementType;

  /** بوحدة الأساس: موجبة = دخول، سالبة = خروج */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    transformer: decimalTransformer,
  })
  quantity!: number;

  /** تكلفة الوحدة وقت الحركة (تكلفة الشراء للداخل، المتوسط للخارج) */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: decimalTransformer,
  })
  unitCost!: number;

  /** رصيد الصنف في هذا المخزن بعد الحركة */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    transformer: decimalTransformer,
  })
  balanceAfter!: number;

  /** المستند الذي أنشأ الحركة: transfer / stocktake / purchase / sale ... */
  @Column({ type: 'varchar', length: 40, nullable: true })
  referenceType?: string | null;

  @Column({ type: 'uuid', nullable: true })
  referenceId?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;

  /** وقت حدوث الحركة فعلياً (بيع أوفلاين يُرفع لاحقاً يحتفظ بوقته الأصلي) */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  occurredAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
