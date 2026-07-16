// src/common/decorators/check-quota.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const CHECK_QUOTA_KEY = 'check_quota_key';
// quotaKey = اسم الحقل داخل PlanQuotas، مثال: 'max_employees'
export const CheckQuota = (quotaKey: string) =>
  SetMetadata(CHECK_QUOTA_KEY, quotaKey);
