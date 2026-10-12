// src/modules/catalog/entities/product-barcode.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Product } from './product.entity';
import { Unit } from './unit.entity';

/**
 * باركود صنف. للصنف الواحد أكثر من باركود (مورّدون مختلفون، أو باركود
 * للكرتونة غير باركود القطعة — عندها يُحدَّد unitId).
 *
 * بلا حذف منطقي: عند حذف الصنف تُحذف باركوداته فعلياً حتى يمكن إعادة
 * استخدامها لصنف آخر.
 */
@Entity('product_barcodes')
@Index(['tenantId', 'barcode'], { unique: true })
export class ProductBarcode {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Index()
  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, (product) => product.barcodes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  @Column()
  barcode!: string;

  /** الوحدة التي يبيعها هذا الباركود. null = وحدة الأساس */
  @Column({ type: 'uuid', nullable: true })
  unitId?: string | null;

  @ManyToOne(() => Unit, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'unitId' })
  unit?: Unit | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
