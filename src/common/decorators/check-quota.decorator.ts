// src/common/decorators/check-quota.decorator.ts
import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';

export const CHECK_QUOTA_KEY = 'check_quota_key';
/** امتداد OpenAPI يحمل حد الباقة الذي يستهلكه المسار */
export const QUOTA_EXTENSION = 'x-quota';

// quotaKey = اسم الحقل داخل PlanQuotas، مثال: 'max_employees'
export const CheckQuota = (quotaKey: string) =>
  applyDecorators(
    SetMetadata(CHECK_QUOTA_KEY, quotaKey),
    ApiExtension(QUOTA_EXTENSION, quotaKey),
  );
