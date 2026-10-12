// src/modules/catalog/entities/unit.entity.ts
import { Column, Entity, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';

/** وحدة قياس (قطعة، كيلو، كرتون...) */
@Entity('units')
@Index(['tenantId', 'name'], { unique: true, where: '"deletedAt" IS NULL' })
export class Unit extends TenantOwnedEntity {
  @Column()
  name!: string;

  /** اختصار يظهر في الفاتورة (كجم، كرتون) */
  @Column({ type: 'varchar', nullable: true })
  symbol?: string | null;

  /** تقبل كسوراً (وزن/طول) — القطعة لا تُباع 1.5 */
  @Column({ default: false })
  allowsFractions!: boolean;

  @Column({ default: true })
  isActive!: boolean;
}
