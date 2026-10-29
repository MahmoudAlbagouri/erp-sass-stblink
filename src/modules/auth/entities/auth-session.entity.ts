// src/modules/auth/entities/auth-session.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * جلسة دخول واحدة (جهاز/متصفح). توكن التجديد يحمل معرّفها، ولا يُجدَّد إلا
 * وهي قائمة: الخروج يلغيها فعلاً على السيرفر — لا يكفي حذف التوكن من المتصفح.
 */
@Entity('auth_sessions')
@Index(['userId'])
export class AuthSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** آخر تجديد: الجلسة تمتد مع كل تجديد ما دام صاحبها يستخدمها */
  @Column({ name: 'last_used_at', type: 'timestamptz' })
  lastUsedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  /** خروج، أو كلمة مرور تغيّرت: لا تُجدَّد بعدها */
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;
}
