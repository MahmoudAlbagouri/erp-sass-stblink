// src/modules/manufacturing/entities/bom.entity.ts
//
// قائمة المكوّنات (Bill of Materials) — مشتركة بين المصانع والمطاعم:
//   production  ما يلزم لإنتاج كمية من منتج يدخل المخزون (أمر إنتاج)
//   recipe      وصفة صنف مركّب تُخصم مكوّناتها عند بيعه (المطعم)
//
// الكميات بوحدة أساس كل صنف، ولكمية الدفعة outputQuantity: وصفة "عجينة 10
// كجم" تُكتب لعشرة كيلوجرامات، والطلب على 25 كجم يضربها في 2.5.
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
import { WorkCenter } from './work-center.entity';

const quantity = {
  type: 'numeric' as const,
  precision: 14,
  scale: 4,
  transformer: decimalTransformer,
};
const percent = {
  type: 'numeric' as const,
  precision: 5,
  scale: 2,
  default: 0,
  transformer: decimalTransformer,
};

export enum BomKind {
  PRODUCTION = 'production',
  RECIPE = 'recipe',
}

@Entity('boms')
@Index(['tenantId', 'code'], { unique: true })
@Index(['tenantId', 'productId'])
// قائمة افتراضية واحدة لكل صنف ونوع
@Index(['tenantId', 'productId', 'kind'], {
  unique: true,
  where: '"isDefault" = true AND "deletedAt" IS NULL',
})
export class Bom extends TenantOwnedEntity {
  /** BOM-000001 */
  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: BomKind;

  /** المنتج أو الطبق الناتج */
  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  /** اسم الإصدار: "التركيبة الأساسية"، "تركيبة الصيف" */
  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'int', default: 1 })
  version!: number;

  /** القائمة المستعملة تلقائياً (للبيع وأوامر الإنتاج الجديدة) */
  @Column({ default: true })
  isDefault!: boolean;

  /** كمية الدفعة التي كُتبت لها الأسطر (بوحدة أساس الناتج) */
  @Column({ ...quantity, default: 1 })
  outputQuantity!: number;

  /**
   * نسبة الناتج الجيد المتوقعة % (صناعات تحويلية: فاقد تبخر أو تشذيب).
   * 95 = لإنتاج 100 جيد تُخطط خامات 100/0.95. المصانع فقط.
   */
  @Column({ ...percent, default: 100 })
  expectedYieldPercent!: number;

  /** وقت تجهيز الطبق بالدقائق (المطاعم): لجدولة المطبخ */
  @Column({ type: 'int', nullable: true })
  prepMinutes?: number | null;

  @Column({ type: 'text', nullable: true })
  note?: string | null;

  @Column({ default: true })
  isActive!: boolean;

  @OneToMany(() => BomLine, (line) => line.bom)
  lines?: BomLine[];

  @OneToMany(() => BomOperation, (op) => op.bom)
  operations?: BomOperation[];

  @OneToMany(() => BomByproduct, (b) => b.bom)
  byproducts?: BomByproduct[];
}

/** مكوّن: خامة، نصف مصنّع (له قائمة مكوّناته)، أو مكوّن طبق */
@Entity('bom_lines')
@Index(['bomId'])
@Index(['tenantId', 'componentId'])
export class BomLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  bomId!: string;

  @ManyToOne(() => Bom, (bom) => bom.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bomId' })
  bom?: Bom;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'uuid' })
  componentId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'componentId' })
  component?: Product;

  /** الكمية لدفعة outputQuantity، بوحدة أساس المكوّن */
  @Column(quantity)
  quantity!: number;

  /** نسبة الهالك المتوقع للمكوّن % (تقطيع، تسرب): تُضاف على المخطط */
  @Column(percent)
  scrapPercent!: number;

  /** رقم خطوة التصنيع التي يُستهلك فيها (اختياري) */
  @Column({ type: 'int', nullable: true })
  operationSequence?: number | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note?: string | null;
}

/** خطوة تصنيع (Routing): أين ومتى ووقت التجهيز ووقت التشغيل */
@Entity('bom_operations')
@Index(['bomId'])
export class BomOperation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  bomId!: string;

  @ManyToOne(() => Bom, (bom) => bom.operations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bomId' })
  bom?: Bom;

  /** ترتيب الخطوة: 10، 20، 30... */
  @Column({ type: 'int' })
  sequence!: number;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'uuid' })
  workCenterId!: string;

  @ManyToOne(() => WorkCenter, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'workCenterId' })
  workCenter?: WorkCenter;

  /** دقائق التجهيز: مرة لكل أمر إنتاج مهما كانت الكمية */
  @Column({ ...quantity, default: 0 })
  setupMinutes!: number;

  /** دقائق التشغيل لدفعة outputQuantity (تتناسب مع الكمية) */
  @Column({ ...quantity, default: 0 })
  runMinutes!: number;

  @Column({ type: 'text', nullable: true })
  instructions?: string | null;
}

/**
 * منتج ثانوي يخرج مع الإنتاج (شرش من الجبن، نشارة من الخشب). يدخل المخزون
 * بقيمة متوسط تكلفته، وتُخصم قيمته من تكلفة المنتج الأساسي.
 */
@Entity('bom_byproducts')
@Index(['bomId'])
export class BomByproduct {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  bomId!: string;

  @ManyToOne(() => Bom, (bom) => bom.byproducts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bomId' })
  bom?: Bom;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  /** لدفعة outputQuantity، بوحدة أساس المنتج الثانوي */
  @Column(quantity)
  quantity!: number;
}
