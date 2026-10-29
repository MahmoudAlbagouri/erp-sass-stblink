// src/modules/files/entities/stored-file.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import type { FileCategory } from '../file-rules';

/**
 * ملف مرفوع (هوية، مرفق عقد، شهادة، صورة صنف). السجلات الأخرى تشير إليه
 * بمعرّفه، ومساره على القرص لا يخرج من الخادم: الواجهة تصله برابط موقَّع مؤقت
 * (file-url.signer.ts) يصدر فقط في رد من له حق رؤية السجل.
 */
@Entity('files')
@Index(['tenantId', 'createdAt'])
export class StoredFile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant?: Tenant;

  @Column({ type: 'varchar', length: 20 })
  category!: FileCategory;

  /** المسار داخل مجلد التخزين (uploads) */
  @Column({ type: 'varchar', length: 300 })
  storageKey!: string;

  /** الاسم كما رفعه المستخدم (للعرض واسم التحميل) */
  @Column({ type: 'varchar', length: 255 })
  originalName!: string;

  /** النوع المكتشف من محتوى الملف */
  @Column({ type: 'varchar', length: 100 })
  mimeType!: string;

  /** بالبايت؛ null للملفات المنقولة من النظام القديم */
  @Column({ type: 'integer', nullable: true })
  size!: number | null;

  @Column({ type: 'uuid', nullable: true })
  uploadedById!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

/** ما يصل الواجهة عن الملف: بلا مساره ولا شركته */
export interface FileView {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  url: string;
}
