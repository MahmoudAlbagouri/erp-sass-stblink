// src/modules/pos/pos-screen-settings.service.ts
import { Injectable } from '@nestjs/common';
import {
  matchingTemplate,
  POS_FEATURE_GROUPS,
  POS_FEATURE_KEYS,
  POS_FEATURE_PLAN,
  POS_FEATURE_REQUIRES,
  POS_TEMPLATES,
  PosFeatureKey,
  PosFeatures,
} from '../../common/constants/pos-features';
import { resolvePosOptions } from '../sales/entities/sales-settings.entity';
import { SalesSettingsService } from '../sales/sales-settings.service';
import { SubscriptionManagerService } from '../subscriptions/subscription-manager.service';
import { UpdatePosScreenSettingsDto } from './dto/pos-screen.dto';

/**
 * مميزات شاشة الكاشير لكل شركة: ما يظهر من أزرار واختصارات. تُحفظ في
 * `sales_settings.posOptions` فتنزل للأجهزة مع مزامنتها (وتعمل بلا إنترنت).
 * المميزات المرتبطة بالباقة (التوصيل، الطاولات، المطبخ) تظهر لمن في باقته.
 */
@Injectable()
export class PosScreenSettingsService {
  constructor(
    private readonly salesSettings: SalesSettingsService,
    private readonly subscriptions: SubscriptionManagerService,
  ) {}

  async get(tenantId: string) {
    const options = resolvePosOptions(
      (await this.salesSettings.get(tenantId)).posOptions,
    );
    return {
      template: options.template,
      features: options.features,
      /** ما تسمح به الباقة: false = الميزة مقفلة "ليست في باقتك" */
      available: await this.available(tenantId),
      groups: POS_FEATURE_GROUPS,
      templates: POS_TEMPLATES,
      requires: POS_FEATURE_REQUIRES,
    };
  }

  async update(tenantId: string, dto: UpdatePosScreenSettingsDto) {
    const current = resolvePosOptions(
      (await this.salesSettings.get(tenantId)).posOptions,
    );
    let next: PosFeatures = { ...current.features };
    if (dto.template) {
      next = {
        ...POS_TEMPLATES.find((template) => template.key === dto.template)!
          .features,
      };
    }
    for (const key of POS_FEATURE_KEYS) {
      const value = dto.features?.[key];
      if (value !== undefined) next[key] = value;
    }
    // البيع الآجل وإضافة عميل بلا اختيار عميل لا معنى لهما
    for (const [key, required] of Object.entries(POS_FEATURE_REQUIRES) as [
      PosFeatureKey,
      PosFeatureKey,
    ][]) {
      if (!next[required]) next[key] = false;
    }

    const now = new Date().toISOString();
    const disabledAt = { ...current.featureDisabledAt };
    for (const key of POS_FEATURE_KEYS) {
      if (current.features[key] && !next[key]) disabledAt[key] = now;
      else if (next[key]) delete disabledAt[key];
    }

    await this.salesSettings.updatePosOptions(tenantId, {
      features: next,
      template: matchingTemplate(next),
      featureDisabledAt: disabledAt,
      // باركود الميزان مصدره الوحيد scale.enabled (وتفاصيله في صفحة الفوترة)
      scale: { ...current.scale, enabled: next.scaleBarcode },
    });
    return this.get(tenantId);
  }

  private async available(
    tenantId: string,
  ): Promise<Partial<Record<PosFeatureKey, boolean>>> {
    const entries = await Promise.all(
      (Object.entries(POS_FEATURE_PLAN) as [PosFeatureKey, string][]).map(
        async ([key, feature]) =>
          [
            key,
            await this.subscriptions
              .hasFeature(tenantId, feature)
              .catch(() => false),
          ] as const,
      ),
    );
    return Object.fromEntries(entries);
  }
}
