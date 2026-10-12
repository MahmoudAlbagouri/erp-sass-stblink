// src/modules/inventory/entities/inventory-item.entity.ts
import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';

/**
 * بيانات الصنف المخزنية على مستوى الشركة (سجل واحد لكل صنف):
 * متوسط التكلفة المرجّح، آخر تكلفة شراء، والكمية "في الطريق" بين المخازن.
 *
 * التكلفة على مستوى الشركة لا المخزن: التحويل بين المخازن لا يغيّرها،
 * ويتغيّر المتوسط فقط عند دخول بضاعة بتكلفة جديدة (شراء / رصيد افتتاحي).
 *
 * هذا السجل هو أيضاً "قفل" الصنف: كل حركة تقفله أولاً (FOR UPDATE) فتُنفَّذ
 * حركات نفس الصنف بالتتابع ولا يفسد المتوسط أو الرصيد عند التزامن.
 */
@Entity('inventory_items')
@Index(['tenantId', 'productId'], { unique: true })
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @Column({ type: 'uuid' })
  productId!: string;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: decimalTransformer,
  })
  avgCost!: number;

  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: decimalTransformer,
  })
  lastCost!: number;

  /** خرجت من مخزن ولم تُستلم في الآخر بعد — ما زالت ملكاً للشركة */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 4,
    default: 0,
    transformer: decimalTransformer,
  })
  inTransitQuantity!: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
