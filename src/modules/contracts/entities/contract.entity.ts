// src/modules/contracts/entities/contract.entity.ts
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

  @Column({ type: 'text', nullable: true })
  notes?: string;

  @Column({ type: 'simple-array', nullable: true })
  attachments?: string[];

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
