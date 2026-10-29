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

  /**
   * أيام راحة هذه الوردية (0 = الأحد … 6 = السبت). فارغة = أيام راحة الشركة
   * (إعدادات الحضور)؛ قائمة فارغة [] = تعمل كل الأسبوع.
   */
  @Column({ type: 'smallint', array: true, nullable: true })
  offDays?: number[] | null;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
