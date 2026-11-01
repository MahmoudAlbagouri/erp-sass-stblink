// src/modules/auth/auth-sessions.ts
// جلسات الدخول على السيرفر: كل دخول يفتح جلسة، وتوكنا الجلسة يحملان معرّفها
// (sid). التجديد يتحقق أنها قائمة ويمدّها، والخروج أو تغيير كلمة المرور يلغيها.
// دوال على EntityManager (لا خدمة) ليستعملها موديول المستخدمين بلا دوران.
import { EntityManager, IsNull, LessThan, MoreThan } from 'typeorm';
import { AuthSession } from './entities/auth-session.entity';

export type SessionClient = 'web' | 'mobile';

/**
 * عمر الجلسة بلا استخدام (= عمر توكن التجديد) بالأيام. الجوال أطول: الموظف قد
 * يفتح التطبيق مرة في الشهر، ولا يصح أن يُخرجه ذلك.
 */
const SESSION_TTL_DAYS: Record<SessionClient, number> = { web: 7, mobile: 60 };

const DAY_MS = 24 * 60 * 60 * 1000;
const expiryOf = (client: SessionClient, from: Date): Date =>
  new Date(from.getTime() + SESSION_TTL_DAYS[client] * DAY_MS);

/** جلسة جديدة، مع حذف جلسات المستخدم المنتهية والملغاة */
export async function openSession(
  manager: EntityManager,
  userId: string,
  client: SessionClient = 'web',
): Promise<string> {
  const now = new Date();
  await manager.delete(AuthSession, { userId, expiresAt: LessThan(now) });
  await manager.delete(AuthSession, { userId, revokedAt: LessThan(now) });
  const session = await manager.save(
    manager.create(AuthSession, {
      userId,
      client,
      lastUsedAt: now,
      expiresAt: expiryOf(client, now),
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
  const session = await manager.findOne(AuthSession, {
    where: {
      id: sessionId,
      userId,
      revokedAt: IsNull(),
      expiresAt: MoreThan(now),
    },
  });
  if (!session) return false;
  await manager.update(AuthSession, session.id, {
    lastUsedAt: now,
    expiresAt: expiryOf(session.client, now),
  });
  return true;
}

/** عمر توكن التجديد لهذه الجلسة، بالأيام */
export async function sessionTtlDays(
  manager: EntityManager,
  sessionId: string,
): Promise<number> {
  const session = await manager.findOne(AuthSession, {
    where: { id: sessionId },
    select: { id: true, client: true },
  });
  return SESSION_TTL_DAYS[session?.client ?? 'web'];
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
