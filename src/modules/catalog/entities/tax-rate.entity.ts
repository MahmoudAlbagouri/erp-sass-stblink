// src/modules/catalog/entities/tax-rate.entity.ts
import { Column, Entity, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';

/**
 * تصنيف الضريبة حسب هيئة الزكاة والضريبة (ZATCA) — مطلوب في الفاتورة
 * الإلكترونية، ونخزّنه من الآن حتى لا نعيد تصنيف الأصناف عند الربط.
 */
export enum TaxCategory {
  STANDARD = 'S', // خاضع بالنسبة الأساسية (15%)
  ZERO_RATED = 'Z', // خاضع بنسبة صفر
  EXEMPT = 'E', // معفى
  OUT_OF_SCOPE = 'O', // خارج نطاق الضريبة
}

@Entity('tax_rates')
@Index(['tenantId', 'name'], { unique: true, where: '"deletedAt" IS NULL' })
export class TaxRate extends TenantOwnedEntity {
  @Column()
  name!: string;

  /** النسبة المئوية: 15 تعني 15% */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    transformer: decimalTransformer,
  })
  rate!: number;

  @Column({ type: 'enum', enum: TaxCategory, default: TaxCategory.STANDARD })
  category!: TaxCategory;

  /** الضريبة المقترحة تلقائياً للأصناف الجديدة (واحدة فقط لكل شركة) */
  @Column({ default: false })
  isDefault!: boolean;

  @Column({ default: true })
  isActive!: boolean;
}
