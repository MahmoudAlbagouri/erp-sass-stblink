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

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
