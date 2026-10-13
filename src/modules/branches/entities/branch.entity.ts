// src/modules/branches/entities/branch.entity.ts
import { Column, Entity, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';

/**
 * فرع: موقع تعمل منه الشركة. له مخازنه (واحد أو أكثر)، وأجهزة كاشيره وبصمته،
 * وموظفوه، والمستخدمون المسموح لهم برؤية بياناته.
 *
 * المستندات التجارية (فواتير، مرتجعات، حركات مخزون) لا تحمل الفرع مباشرة:
 * فرعها هو فرع مخزنها. ما لا مخزن له (الموظف، جهاز البصمة، سند القبض) يحمله.
 *
 * لكل شركة فرع رئيسي واحد دائماً (يُنشأ تلقائياً — انظر branches.util).
 */
@Entity('branches')
@Index(['tenantId', 'name'], { unique: true, where: '"deletedAt" IS NULL' })
@Index(['tenantId'], {
  unique: true,
  where: `"isMain" = true AND "deletedAt" IS NULL`,
})
export class Branch extends TenantOwnedEntity {
  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  code?: string | null;

  /** يُطبع على فواتير الفرع بدل عنوان الشركة */
  @Column({ type: 'varchar', length: 300, nullable: true })
  address?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string | null;

  /** الفرع الرئيسي: لا يُحذف ولا يُوقف، وإليه يُنسب ما لم يُحدَّد فرعه */
  @Column({ default: false })
  isMain!: boolean;

  @Column({ default: true })
  isActive!: boolean;
}
