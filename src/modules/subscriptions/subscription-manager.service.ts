import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, PlanQuotas } from './entities/subscription.entity';
import { SubscriptionStatus } from '../../common/enums/subscription.enums';
import { QuotaRegistryService } from './quota-registry.service';

export interface QuotaCheckResult {
  allowed: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
}

export interface SubscriptionUsageSummary {
  plan: { id: string; name: string; nameAr: string };
  status: SubscriptionStatus;
  startDate: Date;
  endDate?: Date;
  quotas: Record<string, QuotaCheckResult>;
}

@Injectable()
export class SubscriptionManagerService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    private readonly quotaRegistry: QuotaRegistryService,
  ) {}

  async getActiveSubscription(tenantId: string): Promise<Subscription> {
    const subscription = await this.subscriptionRepo.findOne({
      where: { tenantId },
      order: { created_at: 'DESC' },
      relations: ['plan'],
    });

    if (!subscription) {
      throw new NotFoundException(
        `لا يوجد اشتراك مسجل لهذه الشركة (tenantId: ${tenantId})`,
      );
    }

    const isExpirable = ![
      SubscriptionStatus.EXPIRED,
      SubscriptionStatus.CANCELLED,
      SubscriptionStatus.SUSPENDED, // ✅ أضف هذا
      SubscriptionStatus.PENDING, // ✅ وأضف هذا
    ].includes(subscription.status);

    if (
      subscription.endDate &&
      new Date() > subscription.endDate &&
      isExpirable
    ) {
      subscription.status = SubscriptionStatus.EXPIRED;
      await this.subscriptionRepo.save(subscription);
    }

    return subscription;
  }

  async isSubscriptionActive(tenantId: string): Promise<boolean> {
    const subscription = await this.getActiveSubscription(tenantId);
    return [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL].includes(
      subscription.status,
    );
  }

  async hasFeature(tenantId: string, featureKey: string): Promise<boolean> {
    const subscription = await this.getActiveSubscription(tenantId);

    if (
      ![SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL].includes(
        subscription.status,
      )
    ) {
      return false;
    }

    return subscription.plan.features.includes(featureKey);
  }

  private mergeQuotas(subscription: Subscription): PlanQuotas {
    return {
      ...subscription.plan.quotas,
      ...(subscription.quotaOverrides || {}),
    };
  }

  async checkQuota(
    tenantId: string,
    quotaFieldKey: string,
    resolverKey?: string,
  ): Promise<QuotaCheckResult> {
    const subscription = await this.getActiveSubscription(tenantId);
    const quotas = this.mergeQuotas(subscription);
    const limit = quotas[quotaFieldKey];

    if (limit === undefined || limit === null || limit === -1) {
      return { allowed: true, limit: null, used: 0, remaining: null };
    }

    const used = await this.quotaRegistry.getUsage(
      resolverKey ?? quotaFieldKey,
      tenantId,
    );
    const remaining = Math.max(limit - used, 0);

    return { allowed: used < limit, limit, used, remaining };
  }

  async assertQuotaAvailable(
    tenantId: string,
    quotaFieldKey: string,
    resolverKey?: string,
  ): Promise<void> {
    const result = await this.checkQuota(tenantId, quotaFieldKey, resolverKey);

    if (!result.allowed) {
      throw new ForbiddenException(
        `تم تجاوز الحد المسموح به (${result.limit}) لهذا المورد. الاستخدام الحالي: ${result.used}. يرجى ترقية الخطة للمتابعة.`,
      );
    }
  }

  async getUsageSummary(tenantId: string): Promise<SubscriptionUsageSummary> {
    const subscription = await this.getActiveSubscription(tenantId);
    const quotas = this.mergeQuotas(subscription);

    const quotaSummary: Record<string, QuotaCheckResult> = {};
    for (const quotaKey of Object.keys(quotas)) {
      quotaSummary[quotaKey] = await this.checkQuota(tenantId, quotaKey);
    }

    return {
      plan: {
        id: subscription.plan.id,
        name: subscription.plan.name,
        nameAr: subscription.plan.nameAr,
      },
      status: subscription.status,
      startDate: subscription.startDate,
      endDate: subscription.endDate,
      quotas: quotaSummary,
    };
  }
}
