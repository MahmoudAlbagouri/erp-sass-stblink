// src/modules/subscriptions/dto/update-subscription-status.dto.ts
import { IsEnum, IsOptional, IsInt, Min } from 'class-validator';
import { SubscriptionStatus } from '../../../common/enums/subscription.enums';

export class UpdateSubscriptionStatusDto {
  @IsEnum(SubscriptionStatus)
  newStatus!: SubscriptionStatus;

  @IsInt()
  @Min(1)
  @IsOptional()
  durationDays?: number; // لتفعيل أو تجديد الاشتراك

  @IsOptional()
  reason?: string; // سبب التعليق أو الإلغاء (للتدقيق Audit)
}
