// src/modules/sales/entities/sales-quote.entity.ts
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';
import { Warehouse } from '../../inventory/entities/warehouse.entity';

export enum SalesQuoteStatus {
  /** ينتظر العميل. انتهاء الصلاحية يُحسب من validUntil، لا حالة مخزّنة */
  OPEN = 'open',
  /** تحوّل لفاتورة */
  CONVERTED = 'converted',
  CANCELLED = 'cancelled',
}

/** ما تُفلتر به القوائم: الحالات + "منتهي" (قائم تجاوز صلاحيته) */
export const SALES_QUOTE_FILTERS = [
  'open',
  'expired',
  'converted',
  'cancelled',
] as const;
export type SalesQuoteFilter = (typeof SALES_QUOTE_FILTERS)[number];

/** سطر كما طُبع للعميل: بياناته منسوخة، فالعرض لا يتغيّر لو عُدّل الصنف */
export interface SalesQuoteLine {
  productId: string;
  productName: string;
  sku: string;
  unitId: string;
  unitName: string;
  factor: number;
  quantity: number;
  unitPrice: number;
  /** سعر القائمة حين غيّر الكاشير السعر في هذا العرض */
  listPrice: number | null;
  priceReason: string | null;
  discount: number;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  total: number;
}

const money = {
  type: 'numeric' as const,
  precision: 15,
  scale: 3,
  default: 0,
  transformer: decimalTransformer,
};

/**
 * عرض سعر لعميل الشركة: يصدره الكاشير على جهازه (ربما بلا إنترنت) ويرفعه مع
 * طابوره. مستند معلومات لا بيع: لا مخزون ولا حساب عميل ولا درج ولا ضريبة، فلا
 * يُخزَّن في sales_invoices. الأسطر jsonb لأنها لقطة تُطبع ولا تدخل أي تقرير.
 *
 * غير عروض مالك النظام (موديول quotation: جدول quotations بلا شركة).
 */
@Entity('sales_quotes')
// uuid يولّده الجهاز: إعادة رفع نفس العرض لا تكرّره
@Index(['tenantId', 'uuid'], { unique: true })
@Index(['tenantId', 'number'], { unique: true })
@Index(['tenantId', 'status', 'issuedAt'])
export class SalesQuote extends TenantOwnedEntity {
  @Column({ type: 'uuid' })
  uuid!: string;

  /** QT-POS1-000001 */
  @Column({ type: 'varchar', length: 30 })
  number!: string;

  @Column({
    type: 'enum',
    enum: SalesQuoteStatus,
    default: SalesQuoteStatus.OPEN,
  })
  status!: SalesQuoteStatus;

  /** عميل مسجّل (إن وُجد): به تُنسب الفاتورة عند التحويل */
  @Column({ type: 'uuid', nullable: true })
  customerId?: string | null;

  // بيانات العميل كما طُبعت: عميل عابر يُكتب اسمه بلا تسجيله
  @Column({ type: 'varchar', length: 200, nullable: true })
  customerName?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  customerPhone?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  customerTaxNumber?: string | null;

  /** مخزن جهاز الإصدار: به يُقيَّد المستخدم بفروعه. لا يُحجز منه شيء */
  @Column({ type: 'uuid' })
  warehouseId!: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouseId' })
  warehouse?: Warehouse;

  @Column({ type: 'uuid', nullable: true })
  deviceId?: string | null;

  @Column({ type: 'uuid', nullable: true })
  shiftId?: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  cashierName?: string | null;

  /** المشرف الذي وافق على ما يتجاوز صلاحية الكاشير */
  @Column({ type: 'varchar', length: 150, nullable: true })
  approvedBy?: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;

  /** وقت الإصدار على الجهاز */
  @Column({ type: 'timestamptz' })
  issuedAt!: Date;

  /** آخر يوم صلاحية بتوقيت الشركة */
  @Column({ type: 'date' })
  validUntil!: string;

  @Column({ default: true })
  pricesIncludeTax!: boolean;

  @Column({ type: 'jsonb' })
  lines!: SalesQuoteLine[];

  @Column(money)
  subtotal!: number;

  @Column(money)
  discountTotal!: number;

  @Column(money)
  taxTotal!: number;

  @Column(money)
  total!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  // ─── التحويل لفاتورة ───
  @Column({ type: 'uuid', nullable: true })
  convertedInvoiceId?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  convertedInvoiceNumber?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  convertedAt?: Date | null;

  /** ليس عموداً: قائم تجاوز صلاحيته بتوقيت الشركة */
  expired?: boolean;
}
