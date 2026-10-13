// src/modules/branches/branch-scope.interceptor.ts
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { from, Observable, switchMap } from 'rxjs';
import { DataSource } from 'typeorm';
import type { AuthenticatedRequest } from '../../common/types/auth.types';
import { BranchScope, runInBranchScope } from './branch-scope';

interface ScopeRow {
  branchId: string;
  warehouseId: string | null;
}

/**
 * يحسب نطاق فروع صاحب الطلب ويجعله نافذاً على كل ما ينفّذه الطلب.
 *
 * الفروع نفسها تأتي من التوكن (تتغيّر مع أول تجديد له، أي خلال دقائق من تعديل
 * فروع المستخدم)، أما مخازنها فتُقرأ الآن: مخزن أُضيف للفرع قبل لحظة يظهر
 * فوراً. المستخدم غير المقيَّد لا يكلّف استعلاماً.
 */
@Injectable()
export class BranchScopeInterceptor implements NestInterceptor {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const { user } = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();

    return from(this.resolve(user)).pipe(
      switchMap(
        (scope) =>
          new Observable<unknown>((subscriber) =>
            runInBranchScope(scope, () => next.handle().subscribe(subscriber)),
          ),
      ),
    );
  }

  private async resolve(
    user: AuthenticatedRequest['user'] | undefined,
  ): Promise<BranchScope | null> {
    const branchIds = user?.branchIds ?? [];
    if (!user?.tenantId || user.isSuperAdmin || user.isSystemAdmin) return null;
    if (!branchIds.length) return null;

    // tenantId في الشرط: توكن لا يستطيع أن يفتح فرع شركة أخرى
    const rows = await this.dataSource.query<ScopeRow[]>(
      `SELECT b.id AS "branchId", w.id AS "warehouseId"
         FROM branches b
         LEFT JOIN warehouses w
           ON w."branchId" = b.id AND w."deletedAt" IS NULL
        WHERE b."tenantId" = $1 AND b.id = ANY($2::uuid[])
          AND b."deletedAt" IS NULL`,
      [user.tenantId, branchIds],
    );

    return {
      branchIds: [...new Set(rows.map((row) => row.branchId))],
      warehouseIds: rows.flatMap((row) =>
        row.warehouseId ? [row.warehouseId] : [],
      ),
    };
  }
}
