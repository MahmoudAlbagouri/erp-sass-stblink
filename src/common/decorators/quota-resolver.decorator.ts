// src/common/decorators/quota-resolver.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const QUOTA_RESOLVER_KEY = 'quota_resolver_key';

// ✅ Class Decorator - يُستخدم على أي Provider في أي موديول ليعرّف نفسه كـ "مصدر استهلاك" لمورد معين
// مثال: @QuotaResolverFor('employees') على EmployeesQuotaResolver
export const QuotaResolverFor = (resolverKey: string) =>
  SetMetadata(QUOTA_RESOLVER_KEY, resolverKey);
