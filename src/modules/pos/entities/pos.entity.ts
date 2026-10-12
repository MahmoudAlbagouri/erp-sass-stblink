// src/modules/pos/entities/pos.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';
import { Warehouse } from '../../inventory/entities/warehouse.entity';

const money = {
  type: 'numeric' as const,
  precision: 14,
  scale: 2,
  default: 0,
  transformer: decimalTransformer,
};

/**
 * جهاز كاشير (نقطة بيع) مربوط بمخزن فرع: كل ما يبيعه يخرج من ذلك المخزن.
 * يعمل بلا إنترنت، لذلك يولّد أرقام فواتيره بنفسه: `كود الجهاز-عدّاد محلي`.
 */
@Entity('pos_devices')
// الكود بادئة أرقام الفواتير: يبقى فريداً حتى بعد حذف الجهاز (لا يُعاد استخدامه)
@Index(['tenantId', 'code'], { unique: true })
export class PosDevice extends TenantOwnedEntity {
  @Column()
  name!: string;

  /** بادئة أرقام فواتيره: POS1 ← POS1-000001 */
  @Column({ type: 'varchar', length: 10 })
  code!: string;

  @Column({ type: 'uuid' })
  warehouseId!: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'warehouseId' })
  warehouse?: Warehouse;

  /**
   * آخر عدّاد فاتورة وصل من الجهاز. إذا أُعيد تهيئة الجهاز (مسح بياناته)
   * يكمل من بعده فلا تتكرر أرقامه.
   */
  @Column({ type: 'int', default: 0 })
  lastCounter!: number;

  /** آخر مرة تواصل فيها الجهاز مع السيرفر */
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt?: Date | null;

  @Column({ default: true })
  isActive!: boolean;

  /** ليس عموداً: هل عليه وردية مفتوحة الآن */
  hasOpenShift?: boolean;
}

export enum PosShiftStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

/**
 * وردية كاشير على جهاز: من فتح الدرج بعهدة نقدية حتى تقفيله وعدّ ما فيه.
 * المعرّف يولّده الجهاز (الوردية قد تُفتح بلا إنترنت وتُرفع لاحقاً).
 */
@Entity('pos_shifts')
@Index(['tenantId', 'deviceId', 'status'])
@Index(['tenantId', 'openedAt'])
export class PosShift {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  deviceId!: string;

  @ManyToOne(() => PosDevice, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'deviceId' })
  device?: PosDevice;

  @Column({ type: 'uuid', nullable: true })
  userId?: string | null;

  /** اسم الكاشير وقت الوردية (للتقارير، حتى لو تغيّر المستخدم لاحقاً) */
  @Column({ type: 'varchar', length: 150, nullable: true })
  cashierName?: string | null;

  @Column({ type: 'enum', enum: PosShiftStatus, default: PosShiftStatus.OPEN })
  status!: PosShiftStatus;

  @Column({ type: 'timestamptz' })
  openedAt!: Date;

  /** العهدة النقدية في الدرج عند الفتح */
  @Column(money)
  openingCash!: number;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt?: Date | null;

  // ─── تُحسب عند التقفيل ───
  @Column({ type: 'int', default: 0 })
  invoicesCount!: number;

  @Column(money)
  salesTotal!: number;

  @Column(money)
  cashTotal!: number;

  @Column(money)
  cardTotal!: number;

  /** المفترض في الدرج = العهدة + المبيعات النقدية */
  @Column(money)
  expectedCash!: number;

  /** ما عدّه الكاشير فعلاً عند التقفيل */
  @Column({ ...money, nullable: true, default: null })
  closingCash?: number | null;

  /** المعدود − المفترض (سالب = عجز، موجب = زيادة) */
  @Column(money)
  cashDifference!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
