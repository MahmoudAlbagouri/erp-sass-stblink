// src/modules/catalog/entities/product-unit.entity.ts
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';
import { Product } from './product.entity';
import { Unit } from './unit.entity';

/**
 * وحدة بيع/شراء إضافية للصنف غير وحدة الأساس.
 * مثال: الأساس "قطعة"، والإضافية "كرتون" بمعامل 24 (الكرتون = 24 قطعة).
 * المخزون يُحسب دائماً بوحدة الأساس: بيع كرتون واحد يخصم 24.
 */
@Entity('product_units')
@Index(['productId', 'unitId'], { unique: true })
export class ProductUnit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, (product) => product.units, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  @Column({ type: 'uuid' })
  unitId!: string;

  @ManyToOne(() => Unit, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'unitId' })
  unit?: Unit;

  /** كم وحدة أساس تساوي هذه الوحدة */
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 4,
    transformer: decimalTransformer,
  })
  factor!: number;

  /** سعر خاص لهذه الوحدة. null = سعر الأساس × المعامل */
  @Column({
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  salePrice?: number | null;
}
