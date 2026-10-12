// src/modules/sales/entities/customer.entity.ts
import { Column, Entity, Index } from 'typeorm';
import { TenantOwnedEntity } from '../../../common/entities/tenant-owned.entity';
import { decimalTransformer } from '../../../common/utils/decimal.transformer';

/**
 * عميل له حساب (بيع آجل، فاتورة ضريبية باسمه). البيع النقدي العابر لا يحتاج
 * عميلاً: فاتورته بلا customerId.
 */
@Entity('customers')
@Index(['tenantId', 'code'], { unique: true })
@Index(['tenantId', 'name'])
// مزامنة نقاط البيع تسحب "ما تغيّر منذ وقت معيّن"
@Index(['tenantId', 'updatedAt'])
export class Customer extends TenantOwnedEntity {
  /** CUS-000001 — تسلسلي داخل الشركة */
  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column()
  name!: string;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone?: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email?: string | null;

  /** الرقم الضريبي: وجوده يجعل فاتورته "فاتورة ضريبية" لا "مبسطة" */
  @Column({ type: 'varchar', length: 20, nullable: true })
  taxNumber?: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  commercialRegister?: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address?: string | null;

  /** مهلة السداد بالأيام (0 = نقدي) */
  @Column({ type: 'int', default: 0 })
  paymentTermsDays!: number;

  /** أقصى مديونية مسموحة. null = بلا حد */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  creditLimit?: number | null;

  /** ما كان على العميل قبل بدء استخدام النظام */
  @Column({
    type: 'numeric',
    precision: 14,
    scale: 2,
    default: 0,
    transformer: decimalTransformer,
  })
  openingBalance!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  notes?: string | null;

  @Column({ default: true })
  isActive!: boolean;

  /**
   * ليس عموداً: ما على العميل الآن =
   * الافتتاحي + الفواتير الصادرة − المرتجعات − المقبوضات + المردود له.
   * (سالب = للعميل رصيد عندنا)
   */
  balance?: number;
}
