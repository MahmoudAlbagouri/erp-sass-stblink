// src/modules/manufacturing/entities/production-order.entity.ts
//
// أمر الإنتاج ودورته:
//   draft ── release ──▶ released ── (أول صرف/وقت/استلام) ──▶ in_progress
//        └── cancel                                  └── complete ──▶ completed
//
// عند الإطلاق تُنسخ مكوّنات القائمة وخطواتها على الأمر (لقطة): تعديل القائمة
// بعده لا يغيّر أمراً جارياً. كل ما يحدث يُسجَّل بوقته الفعلي، مخططه مقابل
// فعليه، وسببه — أساس بحوث العمليات (docs/operations-research.md).
import {
  Column,
  CreateDateColumn,
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
import { Warehouse } from '../../inventory/entities/warehouse.entity';
import { Bom } from './bom.entity';
import { WorkCenter } from './work-center.entity';

const quantity = {
  type: 'numeric' as const,
  precision: 14,
  scale: 4,
  default: 0,
  transformer: decimalTransformer,
};
const money = {
  type: 'numeric' as const,
  precision: 15,
  scale: 3,
  default: 0,
  transformer: decimalTransformer,
};
const minutes = {
  type: 'numeric' as const,
  precision: 12,
  scale: 2,
  default: 0,
  transformer: decimalTransformer,
};

export enum ProductionOrderStatus {
  DRAFT = 'draft',
  RELEASED = 'released',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

/** سبب رفض إنتاج تام أو هالك خامة زائد عن المخطط */
export enum ProductionScrapReason {
  DEFECT = 'defect',
  PROCESS_LOSS = 'process_loss',
  MACHINE = 'machine',
  MATERIAL = 'material',
  OPERATOR = 'operator',
  SAMPLE = 'sample',
  OTHER = 'other',
}

/** سبب توقف مركز العمل */
export enum DowntimeReason {
  BREAKDOWN = 'breakdown',
  NO_MATERIAL = 'no_material',
  CHANGEOVER = 'changeover',
  QUALITY = 'quality',
  NO_OPERATOR = 'no_operator',
  POWER = 'power',
  MAINTENANCE = 'maintenance',
  OTHER = 'other',
}

@Entity('production_orders')
@Index(['tenantId', 'number'], { unique: true })
@Index(['tenantId', 'status', 'plannedStartDate'])
@Index(['tenantId', 'productId'])
export class ProductionOrder extends TenantOwnedEntity {
  /** MO-000001 */
  @Column({ type: 'varchar', length: 20 })
  number!: string;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  @Column({ type: 'uuid' })
  bomId!: string;

  @ManyToOne(() => Bom, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'bomId' })
  bom?: Bom;

  @Column({
    type: 'varchar',
    length: 20,
    default: ProductionOrderStatus.DRAFT,
  })
  status!: ProductionOrderStatus;

  /** 1 عاجل … 5 منخفض */
  @Column({ type: 'smallint', default: 3 })
  priority!: number;

  /** الكمية المطلوب إنتاجها (جيدة) بوحدة أساس المنتج */
  @Column(quantity)
  plannedQuantity!: number;

  /** ما استُلم جيداً حتى الآن */
  @Column(quantity)
  producedQuantity!: number;

  /** ما رُفض من الناتج (لا يدخل المخزون، وتكلفته على الجيد) */
  @Column(quantity)
  scrapQuantity!: number;

  /** المخزن الذي يدخله الناتج */
  @Column({ type: 'uuid' })
  warehouseId!: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouseId' })
  warehouse?: Warehouse;

  /** المخزن الذي تُصرف منه الخامات */
  @Column({ type: 'uuid' })
  materialsWarehouseId!: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'materialsWarehouseId' })
  materialsWarehouse?: Warehouse;

  @Column({ type: 'date', nullable: true })
  plannedStartDate?: string | null;

  /** تاريخ التسليم المطلوب */
  @Column({ type: 'date', nullable: true })
  plannedEndDate?: string | null;

  /** رقم دفعة الناتج (فارغ = رقم الأمر) */
  @Column({ type: 'varchar', length: 60, nullable: true })
  outputLotNumber?: string | null;

  /** فارغ = من مدة صلاحية المنتج بدءاً من يوم الاستلام */
  @Column({ type: 'date', nullable: true })
  outputExpiryDate?: string | null;

  /** عميل أو طلب يُنتج له (إنتاج حسب الطلب) — للعرض والتتبع */
  @Column({ type: 'varchar', length: 200, nullable: true })
  reference?: string | null;

  @Column({ type: 'text', nullable: true })
  note?: string | null;

  // ─── التكلفة المخططة (عند الإطلاق، بمتوسط التكلفة وقتها) ───
  @Column(money)
  plannedMaterialCost!: number;

  @Column(money)
  plannedLaborCost!: number;

  @Column(money)
  plannedOverheadCost!: number;

  // ─── التكلفة الفعلية ───
  /** صافي قيمة الخامات المصروفة (المصروف − المردود) */
  @Column(money)
  materialCost!: number;

  /** وقت مراكز العمل × تكلفة ساعتها (يُحسب عند الإكمال) */
  @Column(money)
  laborCost!: number;

  @Column(money)
  overheadCost!: number;

  /** قيمة المنتجات الثانوية المستلمة (تُخصم من تكلفة الأساسي) */
  @Column(money)
  byproductValue!: number;

  /** ما دخل المخزون من قيمة الناتج حتى الآن */
  @Column(money)
  receivedValue!: number;

  /** ما بقي بلا ناتج يحمله عند الإكمال (إكمال بلا كمية جيدة) */
  @Column(money)
  varianceValue!: number;

  /** تكلفة الوحدة الجيدة الفعلية (عند الإكمال) */
  @Column({ ...quantity, default: 0 })
  unitCost!: number;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  releasedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  releasedById?: string | null;

  /** أول نشاط فعلي (صرف، وقت، استلام) */
  @Column({ type: 'timestamptz', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  completedById?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt?: Date | null;

  @OneToMany(() => ProductionOrderMaterial, (m) => m.order)
  materials?: ProductionOrderMaterial[];

  @OneToMany(() => ProductionOrderOperation, (o) => o.order)
  operations?: ProductionOrderOperation[];

  @OneToMany(() => ProductionOrderByproduct, (b) => b.order)
  byproducts?: ProductionOrderByproduct[];
}

/** خامة على الأمر: مخططها، وما صُرف منها ورُدّ */
@Entity('production_order_materials')
@Index(['orderId'])
@Index(['tenantId', 'productId'])
export class ProductionOrderMaterial {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => ProductionOrder, (o) => o.materials, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order?: ProductionOrder;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  /** المخطط بوحدة الأساس (شاملاً الهالك المتوقع والناتج المتوقع) */
  @Column(quantity)
  plannedQuantity!: number;

  @Column(quantity)
  issuedQuantity!: number;

  @Column(quantity)
  returnedQuantity!: number;

  /** صافي قيمة ما صُرف (بتكلفة الصرف) */
  @Column(money)
  cost!: number;

  /** الخطوة التي يُستهلك فيها */
  @Column({ type: 'int', nullable: true })
  operationSequence?: number | null;
}

/** خطوة على الأمر: مخططها من القائمة، وفعليها من سجل الوقت */
@Entity('production_order_operations')
@Index(['orderId'])
@Index(['tenantId', 'workCenterId', 'status'])
export class ProductionOrderOperation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => ProductionOrder, (o) => o.operations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'orderId' })
  order?: ProductionOrder;

  @Column({ type: 'int' })
  sequence!: number;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'uuid' })
  workCenterId!: string;

  @ManyToOne(() => WorkCenter, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'workCenterId' })
  workCenter?: WorkCenter;

  /** pending | in_progress | paused | done */
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: 'pending' | 'in_progress' | 'paused' | 'done';

  @Column(minutes)
  plannedSetupMinutes!: number;

  /** لكامل الكمية المخططة */
  @Column(minutes)
  plannedRunMinutes!: number;

  @Column(minutes)
  actualSetupMinutes!: number;

  @Column(minutes)
  actualRunMinutes!: number;

  @Column(minutes)
  downtimeMinutes!: number;

  /** الكمية التي أنجزتها الخطوة (جيدة) والمرفوضة فيها */
  @Column(quantity)
  quantityDone!: number;

  @Column(quantity)
  quantityScrapped!: number;

  /** لقطة من مركز العمل عند الإطلاق: تغيير سعره لاحقاً لا يغيّر هذا الأمر */
  @Column(money)
  costPerHour!: number;

  @Column(money)
  overheadPerHour!: number;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  instructions?: string | null;
}

/** منتج ثانوي متوقع على الأمر وما استُلم منه */
@Entity('production_order_byproducts')
@Index(['orderId'])
export class ProductionOrderByproduct {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => ProductionOrder, (o) => o.byproducts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'orderId' })
  order?: ProductionOrder;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  @Column(quantity)
  plannedQuantity!: number;

  @Column(quantity)
  receivedQuantity!: number;

  @Column(money)
  value!: number;
}

export enum TimeLogKind {
  SETUP = 'setup',
  RUN = 'run',
  DOWNTIME = 'downtime',
}

/**
 * سجل الوقت: كل فترة تجهيز أو تشغيل أو توقف على خطوة، بمن نفّذها وكم
 * أنجز وما رُفض. endedAt = null للفترة الجارية.
 */
@Entity('production_time_logs')
@Index(['tenantId', 'orderId'])
@Index(['tenantId', 'workCenterId', 'startedAt'])
export class ProductionTimeLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  orderId!: string;

  @Column({ type: 'uuid' })
  operationId!: string;

  @ManyToOne(() => ProductionOrderOperation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'operationId' })
  operation?: ProductionOrderOperation;

  /** منسوخ من الخطوة: تقارير مراكز العمل بلا ربط */
  @Column({ type: 'uuid' })
  workCenterId!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: TimeLogKind;

  @Column({ type: 'timestamptz' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt?: Date | null;

  /** المدة المحسوبة عند الإغلاق (أو المُدخلة يدوياً) */
  @Column(minutes)
  minutes!: number;

  @Column({ type: 'varchar', length: 30, nullable: true })
  downtimeReason?: DowntimeReason | null;

  /** الموظف المنفّذ (اختياري) */
  @Column({ type: 'uuid', nullable: true })
  employeeId?: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  operatorName?: string | null;

  @Column({ type: 'uuid', nullable: true })
  userId?: string | null;

  /** ما أُنجز جيداً في هذه الفترة، وما رُفض وسببه */
  @Column(quantity)
  quantity!: number;

  @Column(quantity)
  scrapQuantity!: number;

  @Column({ type: 'varchar', length: 30, nullable: true })
  scrapReason?: ProductionScrapReason | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

export enum ProductionTransactionType {
  /** صرف خامات */
  ISSUE = 'issue',
  /** ردّ خامات */
  RETURN = 'return',
  /** استلام ناتج (جزئي أو نهائي) */
  OUTPUT = 'output',
}

/**
 * حدث مخزني على الأمر (صرف، ردّ، استلام) بقيمته: منه يُرحَّل القيد (الإنتاج
 * تحت التشغيل ↔ المخزون)، وبوقته يُقاس زمن التدفق.
 */
@Entity('production_transactions')
@Index(['tenantId', 'orderId'])
@Index(['tenantId', 'occurredAt'])
export class ProductionTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => ProductionOrder, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order?: ProductionOrder;

  @Column({ type: 'varchar', length: 20 })
  type!: ProductionTransactionType;

  /** القيمة بالموجب */
  @Column(money)
  value!: number;

  /** للاستلام: الجيد والمرفوض وسببه */
  @Column(quantity)
  quantity!: number;

  @Column(quantity)
  scrapQuantity!: number;

  @Column({ type: 'varchar', length: 30, nullable: true })
  scrapReason?: ProductionScrapReason | null;

  /** فرع مخزن الحدث (للقيد) */
  @Column({ type: 'uuid' })
  warehouseId!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @Column({ type: 'uuid', nullable: true })
  userId?: string | null;

  @Column({ type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
