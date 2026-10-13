// src/modules/inventory/entities/warehouse.entity.ts
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { Branch } from '../../branches/entities/branch.entity';

export enum WarehouseType {
  /** المخزن الرئيسي: يستلم المشتريات ويغذّي الفروع (واحد فقط لكل شركة) */
  MAIN = 'main',
  /** مخزن فرع / نقطة بيع: تُباع منه البضاعة للعملاء */
  BRANCH = 'branch',
}

@Entity('warehouses')
@Index(['tenantId', 'name'], { unique: true, where: '"deletedAt" IS NULL' })
// مخزن رئيسي واحد فقط لكل شركة
@Index(['tenantId'], {
  unique: true,
  where: `"type" = 'main' AND "deletedAt" IS NULL`,
})
@Index(['tenantId', 'branchId'])
export class Warehouse extends TenantOwnedEntity {
  /**
   * الفرع الذي يتبعه المخزن. منه يُعرف فرع كل مستند يخرج من المخزن أو يدخله
   * (فاتورة، مرتجع، حركة، وردية كاشير).
   */
  @Column({ type: 'uuid' })
  branchId!: string;

  @ManyToOne(() => Branch, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'branchId' })
  branch?: Branch;

  @Column()
  name!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  code?: string | null;

  @Column({ type: 'enum', enum: WarehouseType, default: WarehouseType.BRANCH })
  type!: WarehouseType;

  @Column({ type: 'varchar', nullable: true })
  address?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string | null;

  /**
   * هل يُسمح أن ينزل الرصيد تحت الصفر؟
   * الفروع: نعم (الكاشير لا يتعطل إذا تأخر تسجيل التوريد) مع ظهور تنبيه.
   * الرئيسي: لا (ما يخرج منه يجب أن يكون موجوداً فعلاً).
   */
  @Column({ default: true })
  allowNegativeStock!: boolean;

  @Column({ default: true })
  isActive!: boolean;
}
