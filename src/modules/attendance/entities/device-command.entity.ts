import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('device_commands')
@Index('IDX_device_commands_device_pending', ['deviceId', 'isExecuted'])
export class DeviceCommand {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  deviceId: string;

  @Column()
  command: string; // مثال: DATA USER PIN=101...

  @Column({ default: false })
  isExecuted: boolean;

  /** متى أكّد الجهاز تنفيذ الأمر */
  @Column({ type: 'timestamptz', nullable: true })
  executedAt?: Date | null;

  /** رمز النتيجة الذي أعاده الجهاز: 0 = نجاح، غيره = خطأ من الجهاز */
  @Column({ type: 'int', nullable: true })
  returnCode?: number | null;

  @Column()
  tenantId: string;

  @CreateDateColumn()
  createdAt: Date;
}
