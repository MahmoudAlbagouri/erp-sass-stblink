// src/modules/inventory/entities/stock-transfer.entity.ts
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
import { Warehouse } from './warehouse.entity';

export enum StockTransferStatus {
  /** مسودة: لم تخرج البضاعة بعد ويمكن تعديلها */
  DRAFT = 'draft',
  /** خرجت من المخزن المرسِل ولم تُستلم بعد */
  IN_TRANSIT = 'in_transit',
  RECEIVED = 'received',
  CANCELLED = 'cancelled',
}

/** تحويل بضاعة بين مخزنين (غالباً من الرئيسي إلى فرع) على خطوتين: إرسال ثم استلام */
@Entity('stock_transfers')
@Index(['tenantId', 'number'], { unique: true })
@Index(['tenantId', 'status'])
export class StockTransfer extends TenantOwnedEntity {
  /** TR-000001 — تسلسلي داخل الشركة */
  @Column({ type: 'varchar', length: 20 })
  number!: string;

  @Column({ type: 'uuid' })
  fromWarehouseId!: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fromWarehouseId' })
  fromWarehouse?: Warehouse;

  @Column({ type: 'uuid' })
  toWarehouseId!: string;

  @ManyToOne(() => Warehouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'toWarehouseId' })
  toWarehouse?: Warehouse;

  @Column({
    type: 'enum',
    enum: StockTransferStatus,
    default: StockTransferStatus.DRAFT,
  })
  status!: StockTransferStatus;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note?: string | null;

  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  sentById?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  receivedAt?: Date | null;

  @Column({ type: 'uuid', nullable: true })
  receivedById?: string | null;

  @OneToMany(() => StockTransferLine, (line) => line.transfer)
  lines?: StockTransferLine[];

  /** ليس عموداً: عدد الأصناف، يُملأ في قائمة التحويلات */
  linesCount?: number;
}

@Entity('stock_transfer_lines')
@Index(['transferId', 'productId'], { unique: true })
export class StockTransferLine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  transferId!: string;

  @ManyToOne(() => StockTransfer, (transfer) => transfer.lines, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'transferId' })
  transfer?: StockTransfer;

  @Column({ type: 'uuid' })
  productId!: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'productId' })
  product?: Product;

  /** الكمية المرسلة (بوحدة الأساس) */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    transformer: decimalTransformer,
  })
  quantity!: number;

  /** الكمية المستلمة فعلاً. null = لم تُستلم بعد. الأقل من المرسلة = عجز */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    nullable: true,
    transformer: decimalTransformer,
  })
  receivedQuantity?: number | null;

  /** متوسط التكلفة وقت الإرسال */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: decimalTransformer,
  })
  unitCost!: number;
}
