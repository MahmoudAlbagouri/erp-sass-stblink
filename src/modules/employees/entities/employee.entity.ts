// src/modules/employees/entities/employee.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  OneToOne,
  OneToMany,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';
import { Contract } from '../../contracts/entities/contract.entity';
import { Loan } from '../../loans/entities/loan.entity';
import { Advance } from '../../advances/entities/advance.entity';
import { Shift } from '../../shifts/entities/shift.entity';
import { Education } from './education.entity';
import { Department } from '../../departments/entities/department.entity';
import { Branch } from '../../branches/entities/branch.entity';
import { StoredFile } from '../../files/entities/stored-file.entity';

import { Bonus } from '../../bonuses/entities/bonus.entity';
import { Deduction } from '../../deduction/entities/deduction.entity';
import { EndOfService } from '../../eos/entities/eos.entity';
import { ResignationRequest } from '../../resignations/entities/resignation.entity';
import { Salary } from '../../salaries/entities/salary.entity';
import { Settlement } from '../../settlements/entities/settlement.entity';
import { LeaveRequest } from '../../leaves/entities/leave-request.entity';

export enum NationalityType {
  SAUDI = 'saudi',
  NON_SAUDI = 'non_saudi',
  OUTSIDE_SPONSORSHIP = 'outside_sponsorship',
}

@Entity('employees')
export class Employee {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 255 })
  fullName!: string;

  @Column({ unique: true, length: 50 })
  employeeCode!: string;

  /**
   * رقم الموظف على جهاز البصمة إن اختلف عن كوده (موظفون سُجّلوا على الجهاز
   * قبل النظام). فارغ = الجهاز يعرفه بكوده.
   */
  @Column({
    name: 'attendance_pin',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  attendancePin?: string | null;

  @Column({
    type: 'enum',
    enum: NationalityType,
    default: NationalityType.SAUDI,
  })
  nationalityType!: NationalityType;

  @Column({ type: 'date', nullable: true })
  iqamaExpiryDate?: Date | null;

  @Column({ nullable: true })
  nationalId?: string;

  // صورة الهوية/الإقامة: ملف في جدول files (يصل الواجهة برابط موقَّع)
  @Column({ name: 'national_id_card_file_id', type: 'uuid', nullable: true })
  nationalIdCardFileId?: string | null;

  @ManyToOne(() => StoredFile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'national_id_card_file_id' })
  nationalIdCard?: StoredFile | null;

  @Column({ nullable: true, length: 20 })
  phone?: string;

  @Column({ nullable: true, length: 100 })
  jobTitle?: string;

  // ✅ القسم أصبح علاقة (Relation) بدل نص حر
  @Column({ name: 'department_id', nullable: true })
  departmentId?: string;

  @ManyToOne(() => Department, (department) => department.employees, {
    nullable: true,
  })
  @JoinColumn({ name: 'department_id' })
  department?: Department;

  /** الفرع الذي يعمل فيه الموظف */
  @Column({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId?: string | null;

  @ManyToOne(() => Branch, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'branch_id' })
  branch?: Branch | null;

  @Column({
    type: 'enum',
    enum: ['active', 'inactive', 'terminated'],
    default: 'active',
  })
  status!: 'active' | 'inactive' | 'terminated';

  // --- العلاقات (Relations) ---

  @OneToOne(() => User, (user) => user.employee)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @OneToOne(() => Contract, (contract) => contract.employee)
  contract?: Contract;

  @ManyToOne(() => Shift, { nullable: true })
  @JoinColumn({ name: 'shift_id' })
  shift?: Shift;

  @Column({ name: 'shift_id', nullable: true })
  shiftId?: string;

  @OneToMany(() => Education, (edu) => edu.employee, { cascade: true })
  educations?: Education[];

  @OneToMany(() => Advance, (advance) => advance.employee)
  advances?: Advance[];

  @OneToMany(() => Loan, (loan) => loan.employee)
  loans?: Loan[];

  @OneToMany(() => Bonus, (bonus) => bonus.employee)
  bonuses?: Bonus[];

  @OneToMany(() => Deduction, (deduction) => deduction.employee)
  deductions?: Deduction[];

  @OneToMany(() => EndOfService, (eos) => eos.employee)
  endOfServices?: EndOfService[];

  @OneToMany(() => ResignationRequest, (req) => req.employee)
  resignationRequests?: ResignationRequest[];

  @OneToMany(() => LeaveRequest, (leave) => leave.employee)
  leaveRequests?: LeaveRequest[];

  @OneToMany(() => Settlement, (settlement) => settlement.employee)
  settlements?: Settlement[];

  @OneToMany(() => Salary, (salary) => salary.employee)
  salaries?: Salary[];

  // --- بيانات النظام ---

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date;
}
