// src/modules/users/users-quota.resolver.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity'; // تأكد من مسار Entity المستخدم
import { QuotaResolverFor } from '../../common/decorators/quota-resolver.decorator';
import { QuotaResolver } from '../subscriptions/interfaces/quota-resolver.interface';

@QuotaResolverFor('max_users') // ✅ ربط المفتاح بالـ Resolver
@Injectable()
export class UsersQuotaResolver implements QuotaResolver {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async resolve(tenantId: string): Promise<number> {
    // حساب عدد المستخدمين النشطين فقط المرتبطین بالشركة (Tenant)
    return this.userRepo.count({
      where: {
        tenantId,
      },
    });
  }
}
