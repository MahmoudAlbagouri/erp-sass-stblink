// src/modules/pos/entities/restaurant-menu.entity.ts
//
// المطعم المتقدم (ميزة restaurant_module):
//   modifier_groups / modifier_options   الإضافات والتعديلات ("الحجم"، "إضافات")
//                                        وخيارات الوجبة (مشروب الوجبة صنف حقيقي)
//   product_modifier_groups              أي مجموعات تظهر مع أي صنف
//   kitchen_stations                     محطات المطبخ (شواية، مشروبات...) بتصنيفاتها
//   reservations                         حجوزات الطاولات
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
import { DiningTable } from './restaurant.entity';

/** مجموعة إضافات: "الحجم" (اختيار واحد إلزامي)، "إضافات" (حتى 5 اختيارية) */
@Entity('modifier_groups')
@Index(['tenantId', 'name'], { unique: true, where: '"deletedAt" IS NULL' })
export class ModifierGroup extends TenantOwnedEntity {
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /** أقل عدد يُختار (0 = اختيارية، 1+ = إلزامية) */
  @Column({ type: 'int', default: 0 })
  minSelect!: number;

  /** أقصى عدد يُختار (0 = بلا حد) */
  @Column({ type: 'int', default: 1 })
  maxSelect!: number;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ default: true })
  isActive!: boolean;

  @OneToMany(() => ModifierOption, (o) => o.group)
  options?: ModifierOption[];
}

/**
 * خيار في مجموعة: سعره الإضافي، وأثره في المخزون — يضيف مكوّناً (جبنة زيادة،
 * أو صنف الوجبة كالمشروب) أو يحذف مكوّناً من الوصفة ("بدون بصل").
 */
@Entity('modifier_options')
@Index(['groupId'])
export class ModifierOption {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  groupId!: string;

  @ManyToOne(() => ModifierGroup, (g) => g.options, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupId' })
  group?: ModifierGroup;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /** يُضاف لسعر الوحدة (بنفس أساس سعر الصنف: شامل الضريبة أو قبلها) */
  @Column({
    type: 'numeric',
    precision: 13,
    scale: 3,
    default: 0,
    transformer: decimalTransformer,
  })
  priceDelta!: number;

  /** صنف يُستهلك مع كل وحدة (مخزني، أو مركّب بوصفته) */
  @Column({ type: 'uuid', nullable: true })
  productId?: string | null;

  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'productId' })
  product?: Product | null;

  /** كميته لكل وحدة من الصنف المباع (بوحدة أساسه) */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 1,
    transformer: decimalTransformer,
  })
  quantity!: number;

  /** مكوّن يُحذف من وصفة الصنف ("بدون بصل") */
  @Column({ type: 'uuid', nullable: true })
  removesProductId?: string | null;

  /** مختار مسبقاً على الشاشة */
  @Column({ default: false })
  isDefault!: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ default: true })
  isActive!: boolean;
}

@Entity('product_modifier_groups')
@Index(['productId', 'groupId'], { unique: true })
export class ProductModifierGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  @Column({ type: 'uuid' })
  groupId!: string;

  @ManyToOne(() => ModifierGroup, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupId' })
  group?: ModifierGroup;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;
}

/**
 * محطة مطبخ: تستلم أسطر تصنيفاتها من كل بون وتجهّزها وحدها. البون جاهز حين
 * تجهز كل محطاته. بلا محطات: المطبخ كله شاشة واحدة كما كان.
 */
@Entity('kitchen_stations')
@Index(['tenantId', 'name'], { unique: true, where: '"deletedAt" IS NULL' })
export class KitchenStation extends TenantOwnedEntity {
  @Column({ type: 'varchar', length: 80 })
  name!: string;

  /** فرع المحطة (null = كل الفروع) */
  @Column({ type: 'uuid', nullable: true })
  branchId?: string | null;

  /** تصنيفات أصنافها. المحطة بلا تصنيفات تستلم ما لم تأخذه غيرها */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  categoryIds!: string[];

  /** وقت التحضير المستهدف بالدقائق: بعده يظهر البون متأخراً */
  @Column({ type: 'int', nullable: true })
  targetMinutes?: number | null;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ default: true })
  isActive!: boolean;
}

export enum ReservationStatus {
  BOOKED = 'booked',
  SEATED = 'seated',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  NO_SHOW = 'no_show',
}

/** حجز طاولة: من ومتى وكم ضيفاً، وما حدث فعلاً (جلس، ألغى، لم يحضر) */
@Entity('reservations')
@Index(['tenantId', 'reservedAt'])
@Index(['tenantId', 'status'])
export class Reservation extends TenantOwnedEntity {
  /** RS-000001 */
  @Column({ type: 'varchar', length: 20 })
  number!: string;

  @Column({ type: 'uuid', nullable: true })
  branchId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  tableId?: string | null;

  @ManyToOne(() => DiningTable, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'tableId' })
  table?: DiningTable | null;

  @Column({ type: 'uuid', nullable: true })
  customerId?: string | null;

  @Column({ type: 'varchar', length: 150 })
  customerName!: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string | null;

  @Column({ type: 'int', default: 2 })
  guestCount!: number;

  @Column({ type: 'timestamptz' })
  reservedAt!: Date;

  @Column({ type: 'int', default: 90 })
  durationMinutes!: number;

  @Column({ type: 'varchar', length: 20, default: ReservationStatus.BOOKED })
  status!: ReservationStatus;

  /** phone | walk_in | online | other */
  @Column({ type: 'varchar', length: 20, default: 'phone' })
  source!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  /** أوقات ما حدث فعلاً: للحضور ومدة الجلسة الحقيقية */
  @Column({ type: 'timestamptz', nullable: true })
  seatedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;
}
