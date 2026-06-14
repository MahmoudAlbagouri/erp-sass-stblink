// src/modules/leaves/entities/leave-balance.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';

@Entity('leave_balances')
@Index(['employeeId', 'year'], { unique: true }) // لمنع تكرار السنة للموظف الواحد
export class LeaveBalance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'employee_id' })
  employeeId!: string;

  @ManyToOne(() => Employee, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'employee_id' })
  employee!: Employee;

  @Column()
  year!: number;

  @Column({ type: 'int', default: 30 })
  totalAllowance!: number;

  @Column({ type: 'int', default: 0 })
  consumedDays!: number;

  @Column({ name: 'tenant_id' })
  tenantId!: string;
}
