// src/modules/catalog/entities/product.entity.ts
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
import { ProductBarcode } from './product-barcode.entity';
import { ProductCategory } from './product-category.entity';
import { ProductUnit } from './product-unit.entity';
import { TaxRate } from './tax-rate.entity';
import { Unit } from './unit.entity';
import { StoredFile } from '../../files/entities/stored-file.entity';

export enum ProductType {
  /** بضاعة لها رصيد مخزني */
  STOCKED = 'stocked',
  /** خدمة أو صنف بلا مخزون (توصيل، رسوم...) */
  SERVICE = 'service',
}

@Entity('products')
@Index(['tenantId', 'sku'], { unique: true, where: '"deletedAt" IS NULL' })
@Index(['tenantId', 'categoryId'])
// مزامنة نقاط البيع تسحب "ما تغيّر منذ وقت معيّن" لكل شركة
@Index(['tenantId', 'updatedAt'])
export class Product extends TenantOwnedEntity {
  @Column()
  name!: string;

  @Column({ type: 'varchar', nullable: true })
  nameEn?: string | null;

  /** كود الصنف الداخلي — فريد داخل الشركة، ويُولَّد تلقائياً إذا لم يُدخل */
  @Column()
  sku!: string;

  @Column({ type: 'enum', enum: ProductType, default: ProductType.STOCKED })
  type!: ProductType;

  @Column({ type: 'uuid', nullable: true })
  categoryId?: string | null;

  @ManyToOne(() => ProductCategory, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'categoryId' })
  category?: ProductCategory | null;

  /** وحدة الأساس: بها يُحسب المخزون وسعر البيع الأساسي */
  @Column({ type: 'uuid' })
  baseUnitId!: string;

  @ManyToOne(() => Unit, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'baseUnitId' })
  baseUnit?: Unit;

  @Column({ type: 'uuid' })
  taxRateId!: string;

  @ManyToOne(() => TaxRate, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'taxRateId' })
  taxRate?: TaxRate;

  /** سعر بيع وحدة الأساس */
  @Column({
    type: 'numeric',
    precision: 13,
    scale: 3,
    default: 0,
    transformer: decimalTransformer,
  })
  salePrice!: number;

  /** السعر المُدخل شامل الضريبة (المعتاد في التجزئة) أم قبلها */
  @Column({ default: true })
  priceIncludesTax!: boolean;

  /** أقل سعر يُسمح للكاشير بالبيع به بعد الخصم (اختياري) */
  @Column({
    type: 'numeric',
    precision: 13,
    scale: 3,
    nullable: true,
    transformer: decimalTransformer,
  })
  minSalePrice?: number | null;

  @Column({ default: true })
  allowDiscount!: boolean;

  /** يُباع بالوزن (ميزان / باركود موزون) */
  @Column({ default: false })
  isWeighted!: boolean;

  /**
   * سعر مفتوح: لا سعر ثابت (خدمة، خضار بالقيمة)، شاشة الكاشير تطلب السعر عند
   * إضافته للسلة. salePrice يبقى اقتراحاً يظهر في الخانة.
   */
  @Column({ default: false })
  openPrice!: boolean;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'uuid', nullable: true })
  imageFileId?: string | null;

  @ManyToOne(() => StoredFile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'imageFileId' })
  image?: StoredFile | null;

  @Column({ default: true })
  isActive!: boolean;

  @OneToMany(() => ProductBarcode, (barcode) => barcode.product)
  barcodes?: ProductBarcode[];

  @OneToMany(() => ProductUnit, (unit) => unit.product)
  units?: ProductUnit[];
}
