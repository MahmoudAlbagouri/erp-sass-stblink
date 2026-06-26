// src/quotations/entities/quotation.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('quotations')
export class Quotation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ✅ تم حذف tenantId نهائياً

  @Column({ unique: true })
  quotationNumber: string; // QP-2026-0001

  @Column({ nullable: true, unique: true })
  invoiceNumber: string; // INV-2026-0001

  @Column()
  customerName: string;

  @Column({ nullable: true })
  customerPhone: string;

  @Column({ nullable: true })
  customerAddress: string;

  @Column({ type: 'jsonb', default: [] })
  items: any[];

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  subTotal: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  taxAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  grandTotal: number;

  @Column({ nullable: true })
  notes: string;

  @Column({ type: 'jsonb', nullable: true })
  bankAccounts: any[];

  @Column({ type: 'jsonb', nullable: true })
  termsAndConditions: string[];

  @Column({ default: 'draft' })
  status: 'draft' | 'sent' | 'approved' | 'rejected';

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
