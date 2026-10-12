// src/modules/catalog/entities/product-category.entity.ts
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';

/** تصنيف الأصناف — شجري (تصنيف رئيسي ← فرعي) عبر parentId */
@Entity('product_categories')
@Index(['tenantId', 'parentId'])
export class ProductCategory extends TenantOwnedEntity {
  @Column()
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  nameEn?: string | null;

  @Column({ type: 'uuid', nullable: true })
  parentId?: string | null;

  @ManyToOne(() => ProductCategory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'parentId' })
  parent?: ProductCategory | null;

  /** لون الزر في شاشة الكاشير */
  @Column({ type: 'varchar', length: 9, nullable: true })
  color?: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ default: true })
  isActive!: boolean;
}
