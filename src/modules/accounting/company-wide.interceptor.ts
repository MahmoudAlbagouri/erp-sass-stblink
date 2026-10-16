// src/modules/accounting/company-wide.interceptor.ts
import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { scopedBranchIds } from '../branches/branch-scope';

/**
 * الدفاتر للشركة كلها: النقدية والعملاء والموردون حسابات مشتركة بين الفروع،
 * فالمستخدم المقيَّد بفروع لا يرى المحاسبة (يرى المستخدم غير المقيَّد كل
 * الفروع، ويصفّي التقارير بفرع إن شاء).
 *
 * يعمل بعد BranchScopeInterceptor العام (الذي يحسب نطاق الطلب).
 */
@Injectable()
export class CompanyWideInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    if (scopedBranchIds()) {
      throw new ForbiddenException(
        'المحاسبة لمستخدم غير مقيَّد بفروع — الدفاتر للشركة كلها',
      );
    }
    return next.handle();
  }
}
