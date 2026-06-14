import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Employee } from '../../employees/entities/employee.entity';

@Entity('shifts')
export class Shift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'time' })
  startTime: string;

  @Column({ type: 'time' })
  endTime: string;

  @Column({ default: 30 })
  gracePeriod: number;

  // ✅ إضافة العلاقة العكسية هنا:
  @OneToMany(() => Employee, (employee) => employee.shift)
  employees: Employee[];
}
