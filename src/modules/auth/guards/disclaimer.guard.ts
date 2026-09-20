import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { SKIP_DISCLAIMER_KEY } from '../../../common/decorators/skip-disclaimer.decorator';

interface DisclaimerRequestUser {
  isDisclaimerAccepted?: boolean;
}

/**
 * Guard عام (APP_GUARD): يمنع أي API إذا لم يوافق المستخدم على الإقرار.
 *
 * ملاحظة: الـ Guards العامة تعمل قبل Guards الـ Controllers،
 * لذلك يقوم هذا الـ Guard بالتحقق من الـ Token بنفسه (عبر استراتيجية 'jwt')
 * بدلاً من الاعتماد على request.user.
 * - لا يوجد Token صالح  → يمرر الطلب، والراوت نفسه يتولى رفضه بـ 401 (أو هو عام أصلاً).
 * - Token صالح + لم يوافق → 403.
 */
@Injectable()
export class DisclaimerGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_DISCLAIMER_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true;

    // يملأ request.user إذا كان الـ Token صالحاً (ولا يرمي خطأ إذا لم يكن، انظر handleRequest)
    await super.canActivate(context);

    const request = context
      .switchToHttp()
      .getRequest<{ user?: DisclaimerRequestUser | false | null }>();
    const user = request.user;

    if (!user) return true;

    // ✅ fail-closed: أي Token قديم بدون الحقل يُعامل كأنه لم يوافق
    if (user.isDisclaimerAccepted !== true) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'DISCLAIMER_NOT_ACCEPTED',
        message: 'يجب الموافقة على الإقرار والشروط قبل استخدام النظام',
      });
    }

    return true;
  }

  // عدم رمي 401 هنا: هذا الـ Guard وظيفته الحجب بسبب الإقرار فقط
  handleRequest<TUser = unknown>(err: unknown, user: TUser): TUser {
    if (err) {
      throw err instanceof Error
        ? err
        : new Error(
            typeof err === 'string'
              ? err
              : 'Authentication error while validating disclaimer guard',
          );
    }
    return user;
  }
}
