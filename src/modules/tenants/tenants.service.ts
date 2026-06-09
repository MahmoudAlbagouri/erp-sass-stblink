// src/modules/tenants/tenants.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectEntityManager } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
// import * as argon2 from 'argon2';

import { Tenant } from './entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
// import { RegisterTenantDto } from './dto/register-tenant.dto';
import {
  TenantStatus,
  SubscriptionPlan,
} from '../../common/enums/tenant.enums';
// import { UserStatus } from '../../common/enums/user.enums';

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectEntityManager()
    private readonly entityManager: EntityManager,
  ) {}

  /**
   * تسجيل شركة جديدة مع إنشاء المدير الأول في عملية واحدة آمنة
   */
  // async register(
  //   dto: RegisterTenantDto,
  // ): Promise<{ tenant: Tenant; admin: User }> {
  //   return await this.entityManager.transaction(async (manager) => {
  //     // 1. إنشاء الشركة
  //     const tenant = manager.create(Tenant, {
  //       company_name: dto.companyName,
  //       phone: dto.phone,
  //       address: dto.address,
  //       subscription_plan: SubscriptionPlan.FREE,
  //       status: TenantStatus.TRIAL,
  //       trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  //       max_users: 5,
  //       storage_limit_mb: 1000,
  //       language: 'ar',
  //       timezone: 'UTC+3',
  //     });
  //     await manager.save(tenant);

  //     // 2. تشفير كلمة مرور المدير
  //     const hashedPassword = await argon2.hash(dto.password);

  //     // 3. إنشاء المدير وربطه بالشركة تلقائياً
  //     const admin = manager.create(User, {
  //       username: dto.username,
  //       email: dto.email,
  //       password: hashedPassword,
  //       tenantId: tenant.id,
  //       isSuperAdmin: true,
  //       status: UserStatus.ACTIVE,
  //     });
  //     await manager.save(admin);

  //     return { tenant, admin };
  //   });
  // }

  async create(createTenantDto: CreateTenantDto): Promise<Tenant> {
    const defaults = {
      subscription_plan: SubscriptionPlan.FREE,
      status: TenantStatus.TRIAL,
      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      max_users: 5,
      storage_limit_mb: 1000,
      language: 'ar',
      timezone: 'UTC+3',
    };

    const tenant = this.tenantRepository.create({
      ...defaults,
      ...createTenantDto,
    });

    return this.tenantRepository.save(tenant);
  }

  async findAll(): Promise<Tenant[]> {
    return this.tenantRepository.find({ order: { created_at: 'DESC' } });
  }

  async findOne(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.findOne({ where: { id } });
    if (!tenant) {
      throw new NotFoundException(`Tenant with ID ${id} not found`);
    }
    return tenant;
  }

  async update(id: string, updateTenantDto: UpdateTenantDto): Promise<Tenant> {
    const tenant = await this.findOne(id);
    Object.assign(tenant, updateTenantDto);
    return this.tenantRepository.save(tenant);
  }
  /**
   * حذف الشركة وجميع بياناتها المرتبطة بشكل آمن (Soft Delete)
   */
  async remove(id: string): Promise<void> {
    return await this.entityManager.transaction(async (manager) => {
      // 1. التحقق من وجود الشركة
      const tenant = await manager.findOne(Tenant, { where: { id } });
      if (!tenant) {
        throw new NotFoundException(`Tenant with ID ${id} not found`);
      }

      // 2. الحذف الناعم لجميع المستخدمين المرتبطين بالشركة
      // onDelete: 'CASCADE' في الـ Entity يحذفهم نهائياً، لذا نستخدم softRemove يدوياً للأرشفة
      await manager.softDelete(User, { tenantId: id });

      // إذا كان لديك موديول Employees، أضف هنا:
      // await manager.softDelete(Employee, { tenantId: id });

      // 3. الحذف الناعم للشركة نفسها
      await manager.softDelete(Tenant, { id });
    });
  }

  async checkSubscriptionValidity(tenantId: string): Promise<boolean> {
    const tenant = await this.findOne(tenantId);

    if (
      tenant.status === TenantStatus.SUSPENDED ||
      tenant.status === TenantStatus.EXPIRED
    ) {
      return false;
    }

    if (tenant.status === TenantStatus.TRIAL && tenant.trial_ends_at) {
      if (new Date() > tenant.trial_ends_at) {
        tenant.status = TenantStatus.EXPIRED;
        await this.tenantRepository.save(tenant);
        return false;
      }
    }

    return true;
  }
}
