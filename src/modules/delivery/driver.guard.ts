// src/modules/delivery/driver.guard.ts
import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { FEATURES } from '../../common/constants/features';
import { SubscriptionManagerService } from '../subscriptions/subscription-manager.service';
import { DRIVER_AGENT_HEADER, DRIVER_KEY_HEADER } from './delivery.constants';
import { DeliveryService } from './delivery.service';
import type { DeliveryAgent } from './entities/delivery.entity';

/** اشتراك الشركة غير سارٍ (نفس كود شاشة الكاشير) */
const HTTP_SUBSCRIPTION_INACTIVE = 402;

type DriverRequest = Request & { driver?: DeliveryAgent };

/**
 * يصادق شاشة الطيار برابطه — لا بحساب مستخدم. الطيار لا يحتاج حساباً في
 * النظام: المدير يصدر له رابطاً من صفحة الطيارين، فيفتحه على جواله.
 *
 *   401  الرابط غير صالح أو أُبطل أو الطيار موقوف
 *   402  اشتراك الشركة غير سارٍ أو لا يشمل التوصيل
 */
@Injectable()
export class DriverGuard implements CanActivate {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly subscriptions: SubscriptionManagerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DriverRequest>();
    const agentId = header(request, DRIVER_AGENT_HEADER);
    const key = header(request, DRIVER_KEY_HEADER);
    if (!agentId || !key || !UUID_PATTERN.test(agentId)) {
      throw new UnauthorizedException(INVALID_LINK);
    }

    const agent = await this.delivery.authenticateDriver(agentId, key);
    if (!agent) throw new UnauthorizedException(INVALID_LINK);
    if (!agent.isActive) {
      throw new UnauthorizedException(`"${agent.name}" موقوف — راجع المدير`);
    }

    const allowed = await this.subscriptions
      .hasFeature(agent.tenantId, FEATURES.DELIVERY_MODULE.name)
      .catch(() => false);
    if (!allowed) {
      throw new HttpException(
        'اشتراك الشركة غير سارٍ أو لا يشمل التوصيل',
        HTTP_SUBSCRIPTION_INACTIVE,
      );
    }

    request.driver = agent;
    return true;
  }
}

/** الطيار الذي صادقه DriverGuard */
export const CurrentDriver = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): DeliveryAgent =>
    ctx.switchToHttp().getRequest<DriverRequest>().driver!,
);

const INVALID_LINK =
  'رابط الطيار غير صالح أو أُوقف — اطلب رابطاً جديداً من المدير';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function header(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
