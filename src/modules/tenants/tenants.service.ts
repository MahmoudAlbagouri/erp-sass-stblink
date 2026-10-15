// src/modules/tenants/tenants.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, InjectEntityManager } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';

import { Tenant } from './entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionManagerService } from '../subscriptions/subscription-manager.service';
import {
  getCountry,
  type CountryConfig,
} from '../../common/constants/countries';
import { normalizePhone } from '../../common/utils/phone.util';
import type { TenantLocale } from '../../common/types/auth.types';
import type { TenantBranding } from './tenant-logo';

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectEntityManager()
    private readonly entityManager: EntityManager,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly subscriptionManager: SubscriptionManagerService,
  ) {}

  async create(
    createTenantDto: CreateTenantDto,
    manager?: EntityManager,
  ): Promise<Tenant> {
    const repo = manager
      ? manager.getRepository(Tenant)
      : this.tenantRepository;

    // العملة والمنطقة الزمنية تُشتقان من الدولة ولا تُقبلان من العميل
    const country = getCountry(createTenantDto.country);
    const tenantData = {
      companyName: createTenantDto.companyName,
      phone: this.normalizePhone(createTenantDto.phone, country),
      address: createTenantDto.address,
      country: country.code,
      currency: country.currency,
      language: createTenantDto.language ?? 'ar',
      timezone: country.timezone,
    };

    const tenant = repo.create(tenantData);
    const savedTenant = await repo.save(tenant);

    // ✅ تم تعديل المدة من 14 إلى 3 أيام هنا
    await this.subscriptionsService.createTrialSubscription(
      savedTenant.id,
      3,
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
    const { country: countryCode, phone, ...rest } = updateTenantDto;
    Object.assign(tenant, rest);

    // تغيير الدولة ينقل معها العملة والمنطقة الزمنية
    if (countryCode && countryCode !== tenant.country) {
      const next = getCountry(countryCode);
      tenant.country = next.code;
      tenant.currency = next.currency;
      tenant.timezone = next.timezone;
    }
    if (phone !== undefined) {
      tenant.phone = this.normalizePhone(phone, getCountry(tenant.country));
    }

    return this.tenantRepository.save(tenant);
  }

  /** اسم الشركة وشعارها كما يُطبعان على الفواتير والتقارير */
  async branding(id: string): Promise<TenantBranding> {
    const tenant = await this.tenantRepository.findOne({
      where: { id },
      select: { id: true, companyName: true, logo_url: true },
    });
    if (!tenant) throw new NotFoundException('الشركة غير موجودة');
    return { companyName: tenant.companyName, logo: tenant.logo_url ?? null };
  }

  /** يرفع شعار الشركة أو يغيّره (null = يحذفه) */
  async setLogo(id: string, logo: string | null): Promise<TenantBranding> {
    await this.findOne(id);
    await this.tenantRepository.update({ id }, { logo_url: logo });
    return this.branding(id);
  }

  /** إعدادات دولة الشركة التي يحملها التوكن (عملة العرض، المنطقة الزمنية) */
  async findLocale(tenantId: string): Promise<TenantLocale> {
    const tenant = await this.tenantRepository.findOne({
      where: { id: tenantId },
      select: { id: true, country: true, currency: true, timezone: true },
    });
    const country = getCountry(tenant?.country);
    return {
      country: country.code,
      currency: tenant?.currency ?? country.currency,
      timezone: tenant?.timezone ?? country.timezone,
    };
  }

  private normalizePhone(
    phone: string | undefined,
    country: CountryConfig,
  ): string | undefined {
    if (!phone?.trim()) return undefined;
    const normalized = normalizePhone(phone, country);
    if (!normalized) {
      throw new BadRequestException(
        `رقم الهاتف غير صالح لدولة ${country.nameAr} (+${country.dialCode})`,
      );
    }
    return normalized;
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
