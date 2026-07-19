import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';

export enum ContractType {
  PERMANENT = 'دائم',
  PART_TIME = 'جزئي',
  FLEXIBLE = 'مرن',
  REMOTE = 'عن بعد',
  OTHER = 'أخرى',
}

export enum TicketType {
  NONE = 'بدون',
  ONE_WAY = 'ذهاب فقط',
  ROUND_TRIP = 'ذهاب وعودة',
}

export enum ProbationPeriod {
  NONE = 'بدون',
  THREE_MONTHS = '3 شهور',
  SIX_MONTHS = '6 شهور',
}

// ✅ إضافة Enum للتأمين الطبي
export enum MedicalInsuranceType {
  NONE = 'بدون',
  INDIVIDUAL = 'فردي',
  FAMILY = 'عائلي',
}

@Entity('employee_contracts')
export class Contract {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'enum',
    enum: ContractType,
    default: ContractType.PERMANENT,
  })
  contractType!: ContractType;

  @Column({ type: 'date' })
  startDate!: Date;

  @Column({ type: 'date', nullable: true })
  endDate?: Date;

  @Column({ type: 'int', default: 30 })
  annualLeaveDays!: number;

  @Column({ name: 'contract_duration_years', type: 'int', nullable: true })
  contractDurationYears?: number;

  @Column({
    type: 'enum',
    enum: TicketType,
    default: TicketType.NONE,
    nullable: true,
  })
  ticketType?: TicketType;

  @Column({
    type: 'enum',
    enum: ProbationPeriod,
    default: ProbationPeriod.NONE,
    nullable: true,
  })
  probationPeriod?: ProbationPeriod;

  // ✅ حقل التأمين الطبي
  @Column({
    type: 'enum',
    enum: MedicalInsuranceType,
    default: MedicalInsuranceType.NONE,
    nullable: true,
  })
  medicalInsurance?: MedicalInsuranceType;

  // ✅ حقل الجنسية (للعقود)
  @Column({ name: 'nationality', nullable: true, length: 100 })
  nationality?: string;

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column('simple-array', { nullable: true })
  attachmentPaths?: string[];

  @Column({ name: 'employee_id' })
  employeeId!: string;

  @OneToOne(() => Employee, (emp) => emp.contract, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee!: Employee;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
