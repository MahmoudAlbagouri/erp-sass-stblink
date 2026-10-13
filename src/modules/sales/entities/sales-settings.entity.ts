// src/modules/sales/entities/sales-settings.entity.ts
import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * بيانات البائع التي تُطبع على الفاتورة وتدخل في رمز QR (سجل واحد لكل شركة).
 * منفصلة عن بيانات الشركة العامة لأنها بيانات ضريبية رسمية: الاسم كما في
 * شهادة التسجيل الضريبي قد يختلف عن الاسم التجاري.
 */
@Entity('sales_settings')
@Index(['tenantId'], { unique: true })
export class SalesSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  /** اسم المنشأة كما في شهادة التسجيل الضريبي */
  @Column({ type: 'varchar', length: 200, nullable: true })
  sellerName?: string | null;

  /** الرقم الضريبي (15 رقماً). بدونه لا يُولَّد رمز QR */
  @Column({ type: 'varchar', length: 20, nullable: true })
  taxNumber?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  commercialRegister?: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string | null;

  /** سطر أسفل الفاتورة المطبوعة (سياسة الاسترجاع، شكر...) */
  @Column({ type: 'varchar', length: 300, nullable: true })
  invoiceFooter?: string | null;

  /** إعدادات شاشة الكاشير: باركود الميزان وما يحتاج موافقة مشرف */
  @Column({ type: 'jsonb', default: () => `'{}'` })
  posOptions!: Partial<PosOptions>;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

/** باركود الميزان (EAN-13 يحمل الوزن أو السعر داخله) */
export interface ScaleBarcodeOptions {
  enabled: boolean;
  /** بادئات الباركود الموزون، مثل ['20','21'] */
  prefixes: string[];
  /** عدد خانات كود الصنف بعد البادئة */
  itemDigits: number;
  /** ما تحمله الخانات الخمس الأخيرة قبل خانة التحقق */
  valueType: 'weight' | 'price';
  /** خانات الكسر في القيمة: 3 = جرامات ← كيلو، 2 = هللات ← ريال */
  valueDecimals: number;
}

export interface PosOptions {
  scale: ScaleBarcodeOptions;
  /** ما يحتاج رقم مشرف السري (لشركة عرّفت كاشيرات) */
  approvals: {
    /** حذف سطر من السلة أو إفراغها أو حذف فاتورة معلّقة */
    void: boolean;
    /** سحب نقد من الدرج */
    cashOut: boolean;
    /** فتح الدرج بلا بيع */
    manualDrawer: boolean;
  };
}

export const DEFAULT_POS_OPTIONS: PosOptions = {
  scale: {
    enabled: false,
    prefixes: ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29'],
    itemDigits: 5,
    valueType: 'weight',
    valueDecimals: 3,
  },
  approvals: { void: false, cashOut: false, manualDrawer: false },
};

/** الإعدادات المحفوظة فوق الافتراضية (شركة لم تحفظ شيئاً تأخذ الافتراضي) */
export function resolvePosOptions(
  saved?: Partial<PosOptions> | null,
): PosOptions {
  return {
    scale: { ...DEFAULT_POS_OPTIONS.scale, ...(saved?.scale ?? {}) },
    approvals: {
      ...DEFAULT_POS_OPTIONS.approvals,
      ...(saved?.approvals ?? {}),
    },
  };
}
