// src/common/context/tenant-context.ts
// شركة صاحب الطلب الحالي — لما يُبنى بعيداً عن الكنترولر ويحتاج هويتها (شعار
// الشركة واسمها في تقارير PDF) بلا تمرير معامل عبر كل استدعاء. نفس أسلوب نطاق
// الفروع (branches/branch-scope).
//
// بلا سياق (مهمة مجدولة، اختبار يستدعي الخدمة مباشرة، مالك النظام): null.
import { AsyncLocalStorage } from 'async_hooks';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../types/auth.types';

const storage = new AsyncLocalStorage<string | null>();

/** ينفّذ `work` وشركة الطلب `tenantId` نافذة على كل ما يستدعيه */
export function runInTenantContext<T>(
  tenantId: string | null,
  work: () => T,
): T {
  return storage.run(tenantId, work);
}

/** شركة الطلب الحالي، أو null */
export function currentTenantId(): string | null {
  return storage.getStore() ?? null;
}

/** يضع شركة صاحب الطلب (من توكنه) في سياق الطلب */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const { user } = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();

    return new Observable<unknown>((subscriber) =>
      runInTenantContext(user?.tenantId ?? null, () =>
        next.handle().subscribe(subscriber),
      ),
    );
  }
}
