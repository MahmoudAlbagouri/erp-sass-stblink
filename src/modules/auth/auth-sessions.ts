// src/modules/auth/auth-sessions.ts
// جلسات الدخول على السيرفر: كل دخول يفتح جلسة، وتوكنا الجلسة يحملان معرّفها
// (sid). التجديد يتحقق أنها قائمة ويمدّها، والخروج أو تغيير كلمة المرور يلغيها.
// دوال على EntityManager (لا خدمة) ليستعملها موديول المستخدمين بلا دوران.
import { EntityManager, IsNull, LessThan, MoreThan } from 'typeorm';
import { AuthSession } from './entities/auth-session.entity';

/** عمر الجلسة بلا استخدام = عمر توكن التجديد */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** جلسة جديدة، مع حذف جلسات المستخدم المنتهية والملغاة */
export async function openSession(
  manager: EntityManager,
  userId: string,
): Promise<string> {
  const now = new Date();
  await manager.delete(AuthSession, { userId, expiresAt: LessThan(now) });
  await manager.delete(AuthSession, { userId, revokedAt: LessThan(now) });
  const session = await manager.save(
    manager.create(AuthSession, {
      userId,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    }),
  );
  return session.id;
}

/** يمدّ جلسة قائمة لصاحبها؛ false لجلسة ملغاة أو منتهية أو لغيره */
export async function extendSession(
  manager: EntityManager,
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const now = new Date();
  const result = await manager.update(
    AuthSession,
    {
      id: sessionId,
      userId,
      revokedAt: IsNull(),
      expiresAt: MoreThan(now),
    },
    {
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    },
  );
  return (result.affected ?? 0) > 0;
}

export async function revokeSession(
  manager: EntityManager,
  sessionId: string,
  userId: string,
): Promise<void> {
  await manager.update(
    AuthSession,
    { id: sessionId, userId, revokedAt: IsNull() },
    { revokedAt: new Date() },
  );
}

/** كل جلسات المستخدم: بعد تغيير كلمة مروره لا يبقى دخول بالقديمة */
export async function revokeUserSessions(
  manager: EntityManager,
  userId: string,
): Promise<void> {
  await manager.update(
    AuthSession,
    { userId, revokedAt: IsNull() },
    { revokedAt: new Date() },
  );
}
