// src/modules/attendance/biometric-devices-quota.resolver.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BiometricDevice } from './entities/biometric-device.entity'; // تأكد من مسار Entity الجهاز
import { QuotaResolverFor } from '../../common/decorators/quota-resolver.decorator';
import { QuotaResolver } from '../subscriptions/interfaces/quota-resolver.interface';

@QuotaResolverFor('max_biometric_devices') // ✅ ربط المفتاح بالـ Resolver
@Injectable()
export class BiometricDevicesQuotaResolver implements QuotaResolver {
  constructor(
    @InjectRepository(BiometricDevice)
    private readonly deviceRepo: Repository<BiometricDevice>,
  ) {}

  async resolve(tenantId: string): Promise<number> {
    // حساب عدد أجهزة البصمة النشطة المرتبطة بالشركة
    return this.deviceRepo.count({
      where: {
        tenantId,
        isActive: true, // افترض أن لديك حقل isActive
      },
    });
  }
}
