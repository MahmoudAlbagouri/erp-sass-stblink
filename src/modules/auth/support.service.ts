// src/modules/auth/support.service.ts
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import type { JwtPayload } from '../../common/types/auth.types';
import {
  getJwtAccessSecret,
  JWT_ACCESS_EXPIRES_IN,
} from '../../config/jwt.config';
import { TenantsService } from '../tenants/tenants.service';
import { SupportSession } from './entities/support-session.entity';

/** تجديد خلال هذه المدة يُعدّ استمراراً لنفس الجلسة لا جلسة جديدة */
const SESSION_GAP_MS = 30 * 60 * 1000;
const LOG_LIMIT = 100;

export interface SupportAccess {
  accessToken: string;
  tenant: { id: string; companyName: string };
}

/**
 * وضع الدعم: مالك النظام يعمل داخل شركة محددة كأنه مديرها — ليرى ما يراه
 * العميل ويساعده.
 *
 * يُصدر توكن وصول قصير العمر يحمل معرّف الشركة، بصلاحيات مدير شركة لا مالك
 * نظام: فيخضع لخطة الشركة وحدودها كعميلها تماماً، ولا يصل لصفحات إدارة
 * النظام وهو داخلها. لا يُصدر توكن تجديد: الجلسة تتجدد فقط بتوكن المالك
 * الأصلي، فانتهاؤه أو سحب صلاحيته ينهيها.
 */
@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportSession)
    private readonly sessions: Repository<SupportSession>,
    private readonly tenants: TenantsService,
    private readonly jwt: JwtService,
  ) {}

  async enter(ownerId: string, tenantId: string): Promise<SupportAccess> {
    // يرمي 404 إذا لم تكن الشركة موجودة
    const tenant = await this.tenants.findOne(tenantId);
    await this.touchSession(ownerId, tenant.id);

    const payload: JwtPayload = {
      sub: ownerId,
      tenantId: tenant.id,
      isSuperAdmin: true,
      isSystemAdmin: false,
      // المالك ليس طرفاً في إقرار الشركة: لا يُحجب بصفحته
      isDisclaimerAccepted: true,
      role: null,
      supportBy: ownerId,
      ...(await this.tenants.findLocale(tenant.id)),
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: getJwtAccessSecret(),
      expiresIn: JWT_ACCESS_EXPIRES_IN,
    });

    return {
      accessToken,
      tenant: { id: tenant.id, companyName: tenant.companyName },
    };
  }

  /** آخر جلسات الدعم (للمراجعة) */
  findRecent(): Promise<SupportSession[]> {
    return this.sessions.find({
      relations: ['tenant'],
      order: { startedAt: 'DESC' },
      take: LOG_LIMIT,
    });
  }

  /** جلسة جديدة، أو تمديد الجارية (التوكن يُجدَّد كل ربع ساعة تقريباً) */
  private async touchSession(ownerId: string, tenantId: string): Promise<void> {
    const now = new Date();
    const current = await this.sessions.findOne({
      where: {
        ownerId,
        tenantId,
        lastSeenAt: MoreThan(new Date(now.getTime() - SESSION_GAP_MS)),
      },
      order: { lastSeenAt: 'DESC' },
    });

    if (current) {
      await this.sessions.update({ id: current.id }, { lastSeenAt: now });
    } else {
      await this.sessions.save(
        this.sessions.create({
          ownerId,
          tenantId,
          startedAt: now,
          lastSeenAt: now,
        }),
      );
    }
  }
}
