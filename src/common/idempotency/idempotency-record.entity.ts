// src/common/idempotency/idempotency-record.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * عملية حفظ وصلت بمفتاح `Idempotency-Key`: ردها محفوظ، فإعادة إرسالها بنفس
 * المفتاح (طابور التطبيق أو الويب بعد انقطاع) تعيد نفس الرد ولا تنفّذها مرتين.
 * المفتاح لكل مستخدم: لا يصطدم مفتاح جهاز بمفتاح جهاز آخر.
 */
@Entity('idempotency_records')
@Index('IDX_idempotency_user_key', ['userId', 'key'], { unique: true })
export class IdempotencyRecord {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_idempotency_records',
  })
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'uuid', nullable: true })
  tenantId!: string | null;

  @Column({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'varchar', length: 10 })
  method!: string;

  @Column({ type: 'varchar', length: 300 })
  path!: string;

  /** false = قيد التنفيذ الآن (طلب ثانٍ بنفس المفتاح يُرد بـ 409) */
  @Column({ type: 'boolean', default: false })
  completed!: boolean;

  /** ما أعاده الطلب أول مرة */
  @Column({ type: 'jsonb', nullable: true })
  response!: unknown;

  @Index('IDX_idempotency_created')
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
