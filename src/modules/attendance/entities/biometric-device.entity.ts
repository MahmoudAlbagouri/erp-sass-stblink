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

/** كيف يوصل الجهاز بصماته للسيرفر */
export enum DeviceProtocol {
  /** ZKTeco وما بُني على برمجياتها: بروتوكول ADMS / Push على /iclock */
  ZK_ADMS = 'zk_adms',
  /** Hikvision: إرسال الأحداث (HTTP Listening) إلى رابط خاص بالجهاز */
  HIKVISION = 'hikvision',
  /** أي جهاز أو برنامج وسيط يرسل البصمات JSON بمفتاح الجهاز */
  API = 'api',
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

  @Column({ length: 20, default: DeviceProtocol.ZK_ADMS })
  protocol!: DeviceProtocol;

  /**
   * عناوين IP المسموح للجهاز الاتصال منها (مفصولة بفواصل، وتقبل نطاقاً مثل
   * 41.33.10.0/24). فارغة = أي عنوان، مع تنبيه حين يتغير عنوانه.
   */
  @Column({ name: 'allowed_ips', type: 'varchar', length: 500, nullable: true })
  allowedIps?: string | null;

  /** إصدار بروتوكول Push كما يعلنه جهاز ZKTeco (به تُصاغ أوامره) */
  @Column({ name: 'push_version', type: 'varchar', length: 20, nullable: true })
  pushVersion?: string | null;

  /**
   * آخر تعريف (handshake) من جهاز ZKTeco: يعلن فيه إصداره، أو لا يعلنه فهو
   * Push 1.x. فارغ = لم يعرّف نفسه منذ أُضيف (حُذف وأعيد وهو متصل مثلاً) فلا
   * نعرف صيغة أوامره بعد.
   */
  @Column({ name: 'handshake_at', type: 'timestamptz', nullable: true })
  handshakeAt?: Date | null;

  /** بصمة مفتاح الإرسال لأجهزة Hikvision / API (المفتاح نفسه يُعرض مرة واحدة) */
  @Column({
    name: 'push_key_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
    select: false,
  })
  pushKeyHash?: string | null;

  /** آخر سجل عمليات (مستخدمين وبصمات) استلمناه من جهاز ZKTeco */
  @Column({ name: 'oper_log_stamp', default: 0 })
  operLogStamp!: number;

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

  /** أوامر تنتظر الجهاز (تُحسب عند القراءة في قائمة الأجهزة) */
  pendingCommands?: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
