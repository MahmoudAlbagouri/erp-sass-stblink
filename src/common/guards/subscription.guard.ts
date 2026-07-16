// src/common/guards/subscription.guard.ts
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { REQUIRES_FEATURE_KEY } from '../decorators/requires-feature.decorator';
import { CHECK_QUOTA_KEY } from '../decorators/check-quota.decorator';
import { SubscriptionManagerService } from '../../modules/subscriptions/subscription-manager.service';
import { CurrentUserData } from '../decorators/current-user.decorator';

interface RequestWithUser extends Request {
  user: CurrentUserData;
}

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptionManager: SubscriptionManagerService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const featureKey = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRES_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    const quotaKey = this.reflector.getAllAndOverride<string | undefined>(
      CHECK_QUOTA_KEY,
      [context.getHandler(), context.getClass()],
    );

    // ✅ الـ Endpoint دا مش محتاج فحص اشتراك أصلاً
    if (!featureKey && !quotaKey) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) throw new ForbiddenException('غير مصرح بالدخول');

    // ✅ مالك النظام خارج نطاق قيود الاشتراك بالكامل - نفس فلسفة PermissionsGuard عندك
    if (user.isSystemAdmin) return true;

    const tenantId = user.tenantId;
    if (!tenantId) {
      throw new ForbiddenException('لا يمكن التحقق من الاشتراك دون tenantId');
    }

    // 1️⃣ سريان الاشتراك أولاً - شرط أساسي قبل أي فحص آخر
    const isActive =
      await this.subscriptionManager.isSubscriptionActive(tenantId);
    if (!isActive) {
      throw new ForbiddenException(
        'انتهت صلاحية اشتراك شركتكم، يرجى التجديد للمتابعة',
      );
    }

    // 2️⃣ Feature Gating
    if (featureKey) {
      const hasFeature = await this.subscriptionManager.hasFeature(
        tenantId,
        featureKey,
      );
      if (!hasFeature) {
        throw new ForbiddenException(
          `هذه الميزة (${featureKey}) غير متاحة ضمن خطتكم الحالية`,
        );
      }
    }

    // 3️⃣ Quota Enforcement
    if (quotaKey) {
      await this.subscriptionManager.assertQuotaAvailable(tenantId, quotaKey);
    }

    return true;
  }
}
