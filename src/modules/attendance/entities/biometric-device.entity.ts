// src/modules/attendance/entities/biometric-device.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Branch } from '../../branches/entities/branch.entity';

export enum DeviceStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  DISABLED = 'disabled',
}

@Entity('biometric_devices')
export class BiometricDevice {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ✅ SN الجهاز - المفتاح الفريد للتعرف على الجهاز (مثال: JHG3255001087)
  @Column({ unique: true })
  @Index()
  serialNumber!: string;

  @Column({ nullable: true })
  alias?: string; // اسم مخصص مثل "بوابة المدخل الرئيسي"

  @Column({ nullable: true })
  ipAddress?: string;

  @Column({ nullable: true })
  location?: string; // "مبنى أ - الطابق الأول"

  @Column({ nullable: true })
  model?: string; // MB10

  /**
   * منطقة ساعة الجهاز (IANA). فارغة = منطقة الشركة — تُحدَّد فقط لجهاز في
   * فرع بدولة أخرى. بها تُقرأ أوقات البصمات وتُضبط ساعة الجهاز.
   */
  @Column({ type: 'varchar', nullable: true })
  timezone?: string | null;

  @Column({
    type: 'enum',
    enum: DeviceStatus,
    default: DeviceStatus.OFFLINE,
  })
  status!: DeviceStatus;

  // ✅ آخر مرة تواصل فيها الجهاز مع السيرفر
  @Column({ name: 'last_seen_at', nullable: true, type: 'timestamptz' })
  lastSeenAt?: Date;

  // ✅ آخر رقم سجل تم سحبه من الجهاز (لتجنب التكرار)
  @Column({ name: 'last_log_index', default: 0 })
  lastLogIndex!: number;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: Tenant;

  /** الفرع المركَّب فيه الجهاز */
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId?: string | null;

  @ManyToOne(() => Branch, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch | null;

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
