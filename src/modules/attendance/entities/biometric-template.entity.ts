// src/modules/attendance/entities/biometric-template.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Employee } from '../../employees/entities/employee.entity';

/** نوع السجل كما يرفعه جهاز ZKTeco */
export enum TemplateKind {
  /** بصمة إصبع (FP) */
  FINGER = 'FP',
  /** وجه بالصيغة القديمة (FACE) */
  FACE = 'FACE',
  /** الصيغة الموحّدة في الأجهزة الحديثة: إصبع، وجه، كف… (BIODATA) */
  BIODATA = 'BIODATA',
}

/**
 * قالب بصمة سجّله موظف على أحد أجهزة الشركة، ليُنسخ لباقي أجهزتها. يُحفظ
 * فقط حين تفعّل الشركة "نسخ البصمات بين الأجهزة"، والقالب نفسه مشفَّر.
 */
@Entity('biometric_templates')
@Index('UQ_biometric_templates_slot', ['tenantId', 'pinKey', 'kind', 'slot'], {
  unique: true,
})
@Index(['employeeId'])
export class BiometricTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  /** رقم الموظف على الجهاز بعد التطبيع (انظر pinKey) */
  @Column({ name: 'pin_key', length: 30 })
  pinKey!: string;

  /** الموظف صاحب الرقم إن كان مربوطاً */
  @Column({ name: 'employee_id', type: 'uuid', nullable: true })
  employeeId?: string | null;

  @ManyToOne(() => Employee, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee?: Employee | null;

  @Column({ length: 10 })
  kind!: TemplateKind;

  /** موضع القالب: رقم الإصبع (FID)، أو النوع:الرقم:الفهرس في BIODATA */
  @Column({ length: 20 })
  slot!: string;

  /** حقول السجل كما أرسلها الجهاز (عدا الرقم)، مشفّرة */
  @Column({ type: 'text' })
  data!: string;

  @Column({ name: 'source_device_id', type: 'uuid', nullable: true })
  sourceDeviceId?: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
