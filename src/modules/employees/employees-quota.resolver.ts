// src/modules/employees/employees-quota.resolver.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee } from './entities/employee.entity'; // تأكد من مسار Entity الموظف
import { QuotaResolverFor } from '../../common/decorators/quota-resolver.decorator';
import { QuotaResolver } from '../subscriptions/interfaces/quota-resolver.interface';

@QuotaResolverFor('max_employees') // ✅ هذا هو المفتاح الذي يربطه بنظام الاشتراكات
@Injectable()
export class EmployeesQuotaResolver implements QuotaResolver {
  constructor(
    @InjectRepository(Employee)
    private readonly employeeRepo: Repository<Employee>,
  ) {}

  async resolve(tenantId: string): Promise<number> {
    // حساب عدد الموظفين النشطين فقط (أو حسب منطق عملك)
    const count = await this.employeeRepo.count({
      where: {
        tenantId: tenantId,
        status: 'active', // افترض أن لديك حقل status
      },
    });
    return count;
  }
}
