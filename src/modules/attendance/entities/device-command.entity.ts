import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('device_commands')
export class DeviceCommand {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  deviceId: string;

  @Column()
  command: string; // مثال: DATA USER PIN=101...

  @Column({ default: false })
  isExecuted: boolean;

  @Column()
  tenantId: string;

  @CreateDateColumn()
  createdAt: Date;
}
