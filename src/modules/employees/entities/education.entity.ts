import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Employee } from './employee.entity';
import { StoredFile } from '../../files/entities/stored-file.entity';

@Entity('employee_educations')
export class Education {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 255 })
  degree!: string;

  @Column({ name: 'certificate_number', nullable: true, length: 100 })
  certificateNumber?: string;

  // ✅ إضافة حقل مصدر/جهة إصدار الشهادة
  @Column({ name: 'issuing_authority', nullable: true, length: 255 })
  issuingAuthority?: string;

  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate?: Date | null;

  @Column({ name: 'attachment_file_id', type: 'uuid', nullable: true })
  attachmentFileId?: string | null;

  @ManyToOne(() => StoredFile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'attachment_file_id' })
  attachment?: StoredFile | null;

  @Column({ name: 'employee_id' })
  employeeId!: string;

  @ManyToOne(() => Employee, (employee) => employee.educations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'employee_id' })
  employee!: Employee;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
