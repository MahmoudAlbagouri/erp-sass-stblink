import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { QUOTA_RESOLVER_KEY } from '../../common/decorators/quota-resolver.decorator';
import { QuotaResolver } from './interfaces/quota-resolver.interface';

@Injectable()
export class QuotaRegistryService implements OnModuleInit {
  private readonly logger = new Logger(QuotaRegistryService.name);
  private readonly resolvers = new Map<string, QuotaResolver>();

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const providers = this.discoveryService.getProviders();

    for (const wrapper of providers) {
      const instance = wrapper.instance as Record<string, unknown> | null;
      if (!instance || typeof instance !== 'object') continue;

      const resolverKey = this.reflector.get<string | undefined>(
        QUOTA_RESOLVER_KEY,
        instance.constructor,
      );

      if (!resolverKey) continue;

      if (
        typeof (instance as unknown as QuotaResolver).resolve !== 'function'
      ) {
        this.logger.warn(
          `️ Provider ${instance.constructor.name} معرّف بـ @QuotaResolverFor('${resolverKey}') لكنه لا يحتوي على دالة resolve()`,
        );
        continue;
      }

      this.resolvers.set(resolverKey, instance as unknown as QuotaResolver);
      this.logger.log(`✅ تم تسجيل Quota Resolver لـ: ${resolverKey}`);
    }
  }

  async getUsage(resolverKey: string, tenantId: string): Promise<number> {
    const resolver = this.resolvers.get(resolverKey);

    if (!resolver) {
      this.logger.warn(
        `لا يوجد Quota Resolver مسجل باسم '${resolverKey}' - سيتم تجاوز الفحص`,
      );
      return 0;
    }

    return resolver.resolve(tenantId);
  }

  hasResolver(resolverKey: string): boolean {
    return this.resolvers.has(resolverKey);
  }
}
