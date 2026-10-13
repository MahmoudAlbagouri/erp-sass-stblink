// src/modules/branches/branch-scope.ts
// نطاق الفروع للطلب الحالي: أي فروع يحق لصاحب الطلب أن يرى ويعمل فيها.
//
// المستخدم المقيَّد بفروع (مدير فرع، كاشير، أمين مخزن) لا يرى بيانات غيرها.
// النطاق يُحسب مرة عند بداية الطلب (BranchScopeInterceptor) ويُحفظ في سياق
// الطلب، فتقرؤه الخدمات مباشرة — بلا تمرير معامل إضافي عبر كل دالة في المشروع.
//
// بلا سياق (مهمة مجدولة، جهاز كاشير أو بصمة يتصل بمفتاحه، اختبار يستدعي الخدمة
// مباشرة) أو لمستخدم غير مقيَّد: النطاق null = كل الفروع.
import { AsyncLocalStorage } from 'async_hooks';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { In, type ObjectLiteral, type SelectQueryBuilder } from 'typeorm';

export interface BranchScope {
  /** الفروع المسموحة */
  branchIds: readonly string[];
  /** مخازن تلك الفروع: بها تُقيَّد المستندات التجارية */
  warehouseIds: readonly string[];
}

const storage = new AsyncLocalStorage<BranchScope | null>();

/** ينفّذ `work` ونطاق الفروع `scope` نافذ على كل ما يستدعيه */
export function runInBranchScope<T>(
  scope: BranchScope | null,
  work: () => T,
): T {
  return storage.run(scope, work);
}

/** نطاق الطلب الحالي، أو null إذا لم يكن مقيَّداً */
export function currentBranchScope(): BranchScope | null {
  return storage.getStore() ?? null;
}

// قيمة لا تطابق أي معرّف: مستخدم مقيَّد بفروع بلا مخازن لا يرى شيئاً
const NOTHING = '00000000-0000-0000-0000-000000000000';
const orNothing = (ids: readonly string[]) =>
  ids.length ? [...ids] : [NOTHING];

/** مخازن النطاق لشرط IN، أو null إذا لم يكن الطلب مقيَّداً */
export function scopedWarehouseIds(): string[] | null {
  const scope = currentBranchScope();
  return scope ? orNothing(scope.warehouseIds) : null;
}

/** فروع النطاق لشرط IN، أو null إذا لم يكن الطلب مقيَّداً */
export function scopedBranchIds(): string[] | null {
  const scope = currentBranchScope();
  return scope ? orNothing(scope.branchIds) : null;
}

export function isWarehouseAllowed(warehouseId?: string | null): boolean {
  const scope = currentBranchScope();
  return !scope || (!!warehouseId && scope.warehouseIds.includes(warehouseId));
}

export function isBranchAllowed(branchId?: string | null): boolean {
  const scope = currentBranchScope();
  return !scope || (!!branchId && scope.branchIds.includes(branchId));
}

/**
 * سجل من مخزن خارج فروع المستخدم يُعامل كغير موجود (404 لا 403): لا يُكشف
 * حتى وجوده.
 */
export function assertWarehouseVisible(
  warehouseId: string | null | undefined,
  notFoundMessage: string,
): void {
  if (!isWarehouseAllowed(warehouseId)) {
    throw new NotFoundException(notFoundMessage);
  }
}

export function assertBranchVisible(
  branchId: string | null | undefined,
  notFoundMessage: string,
): void {
  if (!isBranchAllowed(branchId)) throw new NotFoundException(notFoundMessage);
}

/** اختيار صريح لمخزن خارج الفروع المسموحة (في نموذج إدخال): رفض واضح */
export function assertWarehouseAllowed(warehouseId?: string | null): void {
  if (!isWarehouseAllowed(warehouseId)) {
    throw new ForbiddenException('هذا المخزن يتبع فرعاً خارج فروعك');
  }
}

export function assertBranchAllowed(branchId?: string | null): void {
  if (!isBranchAllowed(branchId)) {
    throw new ForbiddenException('هذا الفرع خارج فروعك');
  }
}

/** يقيّد استعلاماً بمخازن النطاق. `column` مثل ‎"invoice.warehouseId"‎ */
export function restrictToScopedWarehouses<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  column: string,
): SelectQueryBuilder<T> {
  const ids = scopedWarehouseIds();
  return ids
    ? qb.andWhere(`${column} IN (:...scopedWarehouseIds)`, {
        scopedWarehouseIds: ids,
      })
    : qb;
}

/** يقيّد استعلاماً بفروع النطاق. `column` مثل ‎"employee.branchId"‎ */
export function restrictToScopedBranches<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  column: string,
): SelectQueryBuilder<T> {
  const ids = scopedBranchIds();
  return ids
    ? qb.andWhere(`${column} IN (:...scopedBranchIds)`, {
        scopedBranchIds: ids,
      })
    : qb;
}

/**
 * شرط find لسجل يتبع موظفاً (سلفة، إجازة، عقد...): موظفو فروع النطاق فقط.
 * يُفرد داخل where: ‎{ tenantId, ...scopedEmployeeWhere() }‎
 */
export function scopedEmployeeWhere(): {
  employee?: { branchId: ReturnType<typeof In<string>> };
} {
  const ids = scopedBranchIds();
  return ids ? { employee: { branchId: In(ids) } } : {};
}
