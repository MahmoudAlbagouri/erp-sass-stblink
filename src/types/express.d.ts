import { CurrentUserData } from '../modules/auth/dto/current-user.data'; // مسار الـ Interface الخاص بك

declare global {
  namespace Express {
    interface Request {
      user: CurrentUserData; // هنا نخبر TypeScript أن كل request سيكون فيه user بهذا الشكل
    }
  }
}
