import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('shifts')
export class Shift {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  name!: string;

  @Column({ type: 'time' })
  startTime!: string; // "08:00"

  @Column({ type: 'time' })
  endTime!: string; // "16:00"

  @Column({ default: 30 })
  gracePeriod!: number; // بالدقائق

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
