// src/modules/branches/branches.util.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { In, type EntityManager } from 'typeorm';
import { assertBranchAllowed, currentBranchScope } from './branch-scope';
import { Branch } from './entities/branch.entity';

export const MAIN_BRANCH_NAME = 'الفرع الرئيسي';

/**
 * الفرع الرئيسي للشركة، ويُنشأ عند أول حاجة إليه. دالة لا خدمة: يحتاجها أي
 * موديول ينشئ شيئاً يتبع فرعاً (مخزن، موظف، جهاز) دون أن يعتمد على موديول
 * الفروع.
 *
 * الفهرس الفريد (رئيسي واحد لكل شركة) يحسم طلبين متزامنين: واحد يُدرج والآخر
 * يقرأ ما أُدرج.
 */
export async function ensureMainBranch(
  manager: EntityManager,
  tenantId: string,
): Promise<Branch> {
  const repository = manager.getRepository(Branch);
  const find = () => repository.findOne({ where: { tenantId, isMain: true } });

  const existing = await find();
  if (existing) return existing;

  await repository
    .createQueryBuilder()
    .insert()
    .values({ tenantId, name: MAIN_BRANCH_NAME, isMain: true })
    .orIgnore()
    .execute();

  const created = await find();
  if (!created) {
    // اسم "الفرع الرئيسي" مأخوذ لفرع غير رئيسي: حالة لا تنشأ من الواجهة
    throw new Error(`Could not create the main branch for tenant ${tenantId}`);
  }
  return created;
}

/**
 * الفرع الذي يُنسب إليه ما يُنشأ الآن (موظف، جهاز بصمة، مخزن): المختار إن كان
 * فرعاً نشطاً من فروع المستخدم، وإلا فرع المستخدم المقيَّد، وإلا الرئيسي.
 */
export async function resolveBranchId(
  manager: EntityManager,
  tenantId: string,
  branchId?: string | null,
): Promise<string> {
  if (!branchId) {
    return (
      currentBranchScope()?.branchIds[0] ??
      (await ensureMainBranch(manager, tenantId)).id
    );
  }

  const branch = await manager.findOne(Branch, {
    where: { id: branchId, tenantId },
  });
  if (!branch) throw new NotFoundException('الفرع غير موجود');
  if (!branch.isActive) {
    throw new BadRequestException(`الفرع "${branch.name}" موقوف`);
  }
  assertBranchAllowed(branch.id);
  return branch.id;
}

/**
 * فروع مستخدم يُنشأ أو يُعدَّل الآن. القائمة الفارغة = كل الفروع، إلا إذا كان
 * المنفّذ نفسه مقيَّداً: عندها يأخذ المستخدم فروع المنفّذ، فلا يمنح أحدٌ غيرَه
 * رؤية أوسع من رؤيته.
 */
export async function resolveUserBranches(
  manager: EntityManager,
  tenantId: string,
  branchIds: string[] = [],
): Promise<Branch[]> {
  const requested = [...new Set(branchIds)];
  const ids = requested.length
    ? requested
    : [...(currentBranchScope()?.branchIds ?? [])];
  if (!ids.length) return [];

  const branches = await manager.find(Branch, {
    where: { tenantId, id: In(ids) },
  });
  if (branches.length !== ids.length) {
    throw new NotFoundException('الفرع غير موجود');
  }
  branches.forEach((branch) => assertBranchAllowed(branch.id));
  return branches;
}
