import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiscoveryModule } from '@nestjs/core';
import { PlansModule } from '../plans/plans.module';
import { Subscription } from './entities/subscription.entity';
import { SubscriptionManagerService } from './subscription-manager.service';
import { SubscriptionsService } from './subscriptions.service';
import { QuotaRegistryService } from './quota-registry.service';
import { SubscriptionsController } from './subscriptions.controller';

@Module({
  imports: [
    DiscoveryModule,
    TypeOrmModule.forFeature([Subscription]),
    PlansModule,
  ],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionManagerService,
    SubscriptionsService,
    QuotaRegistryService,
  ],
  exports: [
    SubscriptionManagerService,
    SubscriptionsService,
    QuotaRegistryService,
  ],
})
export class SubscriptionsModule {}
