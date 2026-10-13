// test/utils/fixtures.ts
// بيانات جاهزة لاختبارات الـ HTTP: شركة + خطة + اشتراك + مستخدمون بتوكنات حقيقية.
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { SubscriptionStatus } from '../../src/common/enums/subscription.enums';
import type { JwtPayload } from '../../src/common/types/auth.types';
import { getJwtAccessSecret } from '../../src/config/jwt.config';
import { Plan, PlanQuotas } from '../../src/modules/plans/entities/plan.entity';
import { Subscription } from '../../src/modules/subscriptions/entities/subscription.entity';
import { Tenant } from '../../src/modules/tenants/entities/tenant.entity';

const jwt = new JwtService();
let sequence = 0;

export interface TenantFixture {
  tenantId: string;
  /** توكن مدير الشركة (كل الصلاحيات عدا system:) */
  adminToken: string;
  /** توكن موظف بصلاحيات محددة، ومقيَّد بفروع إن حُدِّدت */
  tokenWith: (permissions: string[], branchIds?: string[]) => string;
}

function signToken(payload: Omit<JwtPayload, 'isDisclaimerAccepted'>): string {
  return jwt.sign(
    { ...payload, isDisclaimerAccepted: true },
    { secret: getJwtAccessSecret(), expiresIn: '15m' },
  );
}

/** توكن مالك النظام: يتجاوز الاشتراك والصلاحيات، لكنه بلا شركة (tenantId) */
export function systemOwnerToken(): string {
  return signToken({
    sub: '00000000-0000-4000-a000-000000000001',
    isSuperAdmin: false,
    isSystemAdmin: true,
  });
}

/** شركة باشتراك فعّال على خطة تحمل المميزات والحدود المطلوبة */
export async function createTenantFixture(
  dataSource: DataSource,
  options: { features?: string[]; quotas?: PlanQuotas } = {},
): Promise<TenantFixture> {
  sequence += 1;

  const tenant = await dataSource
    .getRepository(Tenant)
    .save({ companyName: `شركة اختبار ${sequence}` });

  const plan = await dataSource.getRepository(Plan).save({
    name: `TEST_PLAN_${sequence}_${Date.now()}`,
    nameAr: 'خطة اختبار',
    features: options.features ?? [],
    quotas: options.quotas ?? {},
  });

  await dataSource.getRepository(Subscription).save({
    tenantId: tenant.id,
    planId: plan.id,
    status: SubscriptionStatus.ACTIVE,
    startDate: new Date(),
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  const base = { tenantId: tenant.id, isSystemAdmin: false };

  return {
    tenantId: tenant.id,
    adminToken: signToken({
      ...base,
      sub: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
      isSuperAdmin: true,
    }),
    tokenWith: (permissions, branchIds) =>
      signToken({
        ...base,
        branchIds,
        sub: `00000000-0000-4000-9000-${String(sequence).padStart(12, '0')}`,
        isSuperAdmin: false,
        role: {
          id: 'role',
          name: 'موظف',
          permissions: permissions.map((name) => ({ name })),
        },
      }),
  };
}
