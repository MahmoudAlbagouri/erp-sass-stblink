// src/modules/pos/guards/pos-device.guard.ts
import {
  CanActivate,
  ConflictException,
  createParamDecorator,
  ExecutionContext,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { FEATURES } from '../../../common/constants/features';
import { PERMS } from '../../../common/constants/permissions';
import type { JwtPayload } from '../../../common/types/auth.types';
import { getJwtAccessSecret } from '../../../config/jwt.config';
import { SubscriptionManagerService } from '../../subscriptions/subscription-manager.service';
import { PosDevice } from '../entities/pos.entity';
import {
  HTTP_SUBSCRIPTION_INACTIVE,
  POS_DEVICE_HEADER,
  POS_INSTALLATION_HEADER,
  POS_KEY_HEADER,
} from '../pos.constants';
import { deviceKeyMatches } from '../utils/pos-crypto.util';

/** من يقف خلف طلب الجهاز */
export interface PosDeviceContext {
  device: PosDevice;
  /** المستخدم المسجّل دخوله على الشاشة الآن، إن وُجد (للنسبة فقط) */
  userId?: string;
  /** صلاحية المرتجع لوردية بلا كاشير: من المستخدم الحالي، وإلا آخر ما عُرف */
  canReturn: boolean;
}

type PosDeviceRequest = Request & { posContext?: PosDeviceContext };

/**
 * يصادق شاشة كاشير بمفتاح جهازها — لا بجلسة مستخدم.
 *
 * الشاشة تبيع بلا إنترنت أياماً، وتوكن الموظف ينتهي خلالها؛ لو توقف الرفع على
 * تسجيل دخول لتعطّل كل محل أغلق أسبوعاً. المفتاح يصدر مرة عند ربط الشاشة
 * (بجلسة مستخدم له الصلاحية) ويبقى حتى يُفكّ الربط أو يُوقف الجهاز.
 *
 *   401  المفتاح غير صالح أو أُبطل ← الشاشة تحتاج ربطاً جديداً
 *   409  الشاشة ليست المربوطة بالجهاز
 *   402  اشتراك الشركة غير سارٍ أو الكاشير خارج خطتها
 */
@Injectable()
export class PosDeviceGuard implements CanActivate {
  constructor(
    @InjectRepository(PosDevice)
    private readonly devices: Repository<PosDevice>,
    private readonly subscriptions: SubscriptionManagerService,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PosDeviceRequest>();
    const deviceId = header(request, POS_DEVICE_HEADER);
    const key = header(request, POS_KEY_HEADER);
    if (!deviceId || !key || !UUID_PATTERN.test(deviceId)) {
      throw new UnauthorizedException(INVALID_KEY);
    }

    const device = await this.devices
      .createQueryBuilder('device')
      .addSelect('device.keyHash')
      .leftJoinAndSelect('device.warehouse', 'warehouse')
      .where('device.id = :deviceId', { deviceId })
      .getOne();
    if (!device?.keyHash || !deviceKeyMatches(key, device.keyHash)) {
      throw new UnauthorizedException(INVALID_KEY);
    }
    delete device.keyHash;

    if (!device.isActive) {
      throw new UnauthorizedException(
        `جهاز الكاشير "${device.name}" موقوف — راجع المدير`,
      );
    }
    if (device.installationId !== header(request, POS_INSTALLATION_HEADER)) {
      throw new ConflictException(
        `هذه الشاشة ليست المربوطة بالجهاز "${device.name}" — اربطها بجهاز كاشير خاص بها`,
      );
    }

    await this.assertSubscribed(device.tenantId);

    const user = await this.sessionUser(request, device.tenantId);
    if (user && user.canReturn !== device.returnsAllowed) {
      device.returnsAllowed = user.canReturn;
      await this.devices.update(
        { id: device.id },
        { returnsAllowed: user.canReturn },
      );
    }

    request.posContext = {
      device,
      userId: user?.id,
      canReturn: user?.canReturn ?? device.returnsAllowed,
    };
    return true;
  }

  private async assertSubscribed(tenantId: string): Promise<void> {
    const allowed = await this.subscriptions
      .hasFeature(tenantId, FEATURES.POS_MODULE.name)
      // لا اشتراك للشركة إطلاقاً
      .catch(() => false);
    if (!allowed) {
      throw new HttpException(
        'اشتراك الشركة غير سارٍ أو لا يشمل نقاط البيع — جدّد الاشتراك لمتابعة الرفع وفتح الورديات',
        HTTP_SUBSCRIPTION_INACTIVE,
      );
    }
  }

  /**
   * جلسة المستخدم اختيارية هنا: إن أرسلت الشاشة توكناً صالحاً لمستخدم من نفس
   * الشركة نعرف من يعمل عليها. توكن منتهٍ أو غائب ليس خطأ.
   */
  private async sessionUser(
    request: Request,
    tenantId: string,
  ): Promise<{ id: string; canReturn: boolean } | null> {
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) return null;

    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: getJwtAccessSecret(),
      });
      if (payload.tenantId !== tenantId) return null;

      const permissions = payload.role?.permissions?.map((p) => p.name) ?? [];
      return {
        id: payload.sub,
        canReturn:
          payload.isSuperAdmin || permissions.includes(PERMS.POS_RETURN.name),
      };
    } catch {
      return null;
    }
  }
}

/** سياق الجهاز الذي صادقه PosDeviceGuard */
export const PosContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PosDeviceContext =>
    ctx.switchToHttp().getRequest<PosDeviceRequest>().posContext!,
);

const INVALID_KEY = 'مفتاح جهاز الكاشير غير صالح — اربط الشاشة بالجهاز من جديد';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function header(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
