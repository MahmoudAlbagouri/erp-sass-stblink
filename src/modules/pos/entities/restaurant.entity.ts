// src/modules/pos/entities/restaurant.entity.ts
// المطاعم: الطاولات (تنزل لشاشات الكاشير)، طلبات المطبخ (ترفعها الشاشات
// وتعرضها شاشة المطبخ)، وإعدادات المطبخ.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';

/**
 * طاولة في صالة المطعم. الطلب المفتوح عليها يعيش على جهاز الكاشير الذي فتحه
 * (يعمل بلا إنترنت)؛ هنا تعريفها فقط.
 */
@Entity('dining_tables')
@Index(['tenantId', 'branchId'])
export class DiningTable extends TenantOwnedEntity {
  /** "طاولة 5"، "T5"، "VIP 1" */
  @Column({ type: 'varchar', length: 60 })
  name!: string;

  /** القسم: صالة، تراس، عائلات… (تُجمَّع به الطاولات على الشاشة) */
  @Column({ type: 'varchar', length: 60, nullable: true })
  area?: string | null;

  @Column({ type: 'int', default: 4 })
  seats!: number;

  /** فرع الطاولة. null = تظهر في كل الفروع */
  @Column({ type: 'uuid', nullable: true })
  branchId?: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ default: true })
  isActive!: boolean;
}

export enum KitchenOrderStatus {
  NEW = 'new',
  PREPARING = 'preparing',
  READY = 'ready',
  /** سُلّم للعميل (أو أُغلق طلب الطاولة) */
  SERVED = 'served',
  CANCELLED = 'cancelled',
}

export enum KitchenOrderType {
  DINE_IN = 'dine_in',
  TAKEAWAY = 'takeaway',
  DELIVERY = 'delivery',
}

/** سطر في بون المطبخ. الكمية السالبة = إلغاء صنف أُرسل من قبل */
export interface KitchenOrderLine {
  productId: string | null;
  name: string;
  unitName: string | null;
  quantity: number;
  note: string | null;
}

/**
 * بون مطبخ: ما أرسله الكاشير للمطبخ مرة واحدة (أول الطلب، أو إضافة عليه،
 * أو إلغاء منه). المعرّف يولّده الجهاز: يُرسل بلا إنترنت ويُرفع مرة واحدة.
 */
@Entity('kitchen_orders')
@Index(['tenantId', 'branchId', 'status'])
@Index(['tenantId', 'deviceId', 'sentAt'])
@Index(['tenantId', 'orderRef'])
export class KitchenOrder {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  deviceId!: string;

  /** فرع جهاز الكاشير: شاشة مطبخ كل فرع تعرض طلباته */
  @Column({ type: 'uuid', nullable: true })
  branchId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  shiftId?: string | null;

  /** رقم الطلب في وردية الجهاز (يُنادى به) */
  @Column({ type: 'int' })
  ticketNo!: number;

  @Column({ type: 'varchar', length: 20 })
  orderType!: KitchenOrderType;

  @Column({ type: 'uuid', nullable: true })
  tableId?: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  tableName?: string | null;

  /** اسم العميل أو رقم الفاتورة */
  @Column({ type: 'varchar', length: 100, nullable: true })
  label?: string | null;

  /** الطلب على الجهاز: يجمع بونات نفس الطاولة (الأول والإضافات) */
  @Column({ type: 'uuid' })
  orderRef!: string;

  /** 1 = أول إرسال، 2+ = إضافة على نفس الطلب */
  @Column({ type: 'int', default: 1 })
  round!: number;

  @Column({ type: 'varchar', length: 150, nullable: true })
  cashierName?: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  note?: string | null;

  @Column({ type: 'jsonb' })
  lines!: KitchenOrderLine[];

  @Column({
    type: 'enum',
    enum: KitchenOrderStatus,
    default: KitchenOrderStatus.NEW,
  })
  status!: KitchenOrderStatus;

  /** وقت الإرسال على الجهاز (قد يسبق وصوله للسيرفر إن كان بلا إنترنت) */
  @Column({ type: 'timestamptz' })
  sentAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  readyAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  servedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/** إعدادات المطبخ: صف لكل شركة (يُنشأ بالافتراضي عند أول قراءة) */
@Entity('restaurant_settings')
export class RestaurantSettings {
  @PrimaryColumn({ type: 'uuid' })
  tenantId!: string;

  /** تصنيفات تُحضَّر في المطبخ. فارغة = كل الأصناف */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  kitchenCategoryIds!: string[];

  /** طباعة بون المطبخ مع كل إرسال (بلا إنترنت يُطبع دائماً) */
  @Column({ default: true })
  printKitchenTicket!: boolean;

  /** ما لم يُرسل للمطبخ يُرسل تلقائياً عند الدفع (السفري والتوصيل) */
  @Column({ default: true })
  sendOnPayment!: boolean;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
