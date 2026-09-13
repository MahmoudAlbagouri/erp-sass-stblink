import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';

@Entity('departments')
export class Department {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @OneToMany(() => Employee, (employee) => employee.department)
  employees?: Employee[];

  @CreateDateColumn()
  createdAt!: Date;
}
