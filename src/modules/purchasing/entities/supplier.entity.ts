// src/modules/purchasing/entities/supplier.entity.ts
import { Column, Entity, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';

@Entity('suppliers')
@Index(['tenantId', 'code'], { unique: true })
@Index(['tenantId', 'name'], { unique: true, where: '"deletedAt" IS NULL' })
export class Supplier extends TenantOwnedEntity {
  /** SUP-000001 — تسلسلي داخل الشركة */
  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column()
  name!: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  contactPerson?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email?: string | null;

  /** الرقم الضريبي (VAT) — يظهر على فواتير الشراء ويلزم لاحقاً للإقرار الضريبي */
  @Column({ type: 'varchar', length: 20, nullable: true })
  taxNumber?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  commercialRegister?: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address?: string | null;

  /** مهلة السداد بالأيام: منها يُقترح تاريخ استحقاق الفاتورة (0 = نقدي) */
  @Column({ type: 'int', default: 0 })
  paymentTermsDays!: number;

  /** ما كان مستحقاً للمورد قبل بدء استخدام النظام */
  @Column({
    type: 'numeric',
    precision: 15,
    scale: 3,
    default: 0,
    transformer: decimalTransformer,
  })
  openingBalance!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes?: string | null;

  @Column({ default: true })
  isActive!: boolean;

  /**
   * ليس عموداً: المستحق للمورد الآن =
   * الرصيد الافتتاحي + الفواتير المعتمدة − المرتجعات − المدفوعات.
   * (سالب = المورد مدين لنا)
   */
  balance?: number;
}
