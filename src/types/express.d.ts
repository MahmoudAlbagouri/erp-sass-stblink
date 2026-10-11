import type { CurrentUserData } from '../common/types/auth.types';

// passport يعرّف Request.user على أنه Express.User — نوسّعه هنا مرة واحدة
// ليصبح request.user معروف النوع في كامل المشروع.
declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends CurrentUserData {}
  }
}

export {};
