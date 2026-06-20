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
import { Contract } from 'src/modules/contracts/entities/contract.entity';
import { Loan } from 'src/modules/loans/entities/loan.entity';
import { Advance } from 'src/modules/advances/entities/advance.entity';
import { Shift } from 'src/modules/shifts/entities/shift.entity';

// تعريف أنواع الجنسية
export enum NationalityType {
  SAUDI = 'saudi', // سعودي
  NON_SAUDI = 'non_saudi', // غير سعودي
  OUTSIDE_SPONSORSHIP = 'outside_sponsorship', // خارج الكفالة
}

@Entity('employees')
export class Employee {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 255 })
  fullName!: string;

  @Column({ unique: true, length: 50 })
  employeeCode!: string;

  // ✅ إضافة نوع الجنسية
  @Column({
    type: 'enum',
    enum: NationalityType,
    default: NationalityType.SAUDI,
  })
  nationalityType!: NationalityType;

  // ✅ تاريخ انتهاء الإقامة (يظهر فقط لغير السعوديين)
  @Column({ type: 'date', nullable: true })
  iqamaExpiryDate?: Date | null; // ✅ أضف | null هنا

  // حقول الهوية الجديدة
  @Column({ nullable: true })
  nationalId?: string;

  @Column({ nullable: true })
  nationalIdCardPath?: string; // مسار ملف PDF أو صورة الهوية

  @Column({ nullable: true, length: 20 })
  phone?: string;

  @Column({ nullable: true, length: 100 })
  jobTitle?: string;

  @Column({ nullable: true, length: 100 })
  department?: string;

  // ❌ تم حذف hireDate حسب الطلب

  @Column({
    type: 'enum',
    enum: ['active', 'inactive', 'terminated'],
    default: 'active',
  })
  status!: 'active' | 'inactive' | 'terminated';

  @OneToOne(() => User, (user) => user.employee)
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @OneToOne(() => Contract, (contract) => contract.employee)
  contract?: Contract;

  @OneToMany(() => Advance, (advance) => advance.employee)
  advances!: Advance[];

  @OneToMany(() => Loan, (loan) => loan.employee)
  loans!: Loan[];

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Tenant;

  @ManyToOne(() => Shift, { nullable: true })
  @JoinColumn({ name: 'shift_id' })
  shift?: Shift;

  @Column({ name: 'shift_id', nullable: true })
  shiftId?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date;
}
