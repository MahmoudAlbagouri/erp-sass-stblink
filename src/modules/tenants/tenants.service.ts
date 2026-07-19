// src/modules/tenants/tenants.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectEntityManager } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';

import { Tenant } from './entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionManagerService } from '../subscriptions/subscription-manager.service'; // ✅ استيراد خدمة إدارة الاشتراكات

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectEntityManager()
    private readonly entityManager: EntityManager,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly subscriptionManager: SubscriptionManagerService, // ✅ حقن الخدمة للتحقق من الحالة
  ) {}

  async create(
    createTenantDto: CreateTenantDto,
    manager?: EntityManager,
  ): Promise<Tenant> {
    const repo = manager
      ? manager.getRepository(Tenant)
      : this.tenantRepository;

    // ✅ تحويل البيانات لتطابق الـ Entity (snake_case) بدون أي حقول حالة قديمة
    const tenantData = {
      companyName: createTenantDto.companyName,
      phone: createTenantDto.phone,
      address: createTenantDto.address,
      country: createTenantDto.country,
      language: createTenantDto.language ?? 'ar',
      timezone: createTenantDto.timezone ?? 'UTC+3',
    };

    const tenant = repo.create(tenantData);
    const savedTenant = await repo.save(tenant);

    // ✅ إنشاء الاشتراك التجريبي هو المسؤول الوحيد عن تحديد حالة الحساب
    await this.subscriptionsService.createTrialSubscription(
      savedTenant.id,
      14,
      manager,
    );

    return savedTenant;
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

  async remove(id: string): Promise<void> {
    return await this.entityManager.transaction(async (manager) => {
      const tenant = await manager.findOne(Tenant, { where: { id } });
      if (!tenant) {
        throw new NotFoundException(`Tenant with ID ${id} not found`);
      }

      await manager.softDelete(User, { tenantId: id });
      await manager.softDelete(Tenant, { id });
    });
  }

  /**
   * ✅ التحقق من نشاط الحساب يعتمد الآن كلياً على حالة الاشتراك
   * بدلاً من الاعتماد على حقل status المحذوف في جدول tenants
   */
  async isAccountActive(tenantId: string): Promise<boolean> {
    try {
      return await this.subscriptionManager.isSubscriptionActive(tenantId);
    } catch {
      // إذا لم يوجد اشتراك أو حدث خطأ، نعتبر الحساب غير نشط
      return false;
    }
  }
}
