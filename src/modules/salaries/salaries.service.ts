// src/modules/salaries/salaries.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { isIBAN } from 'class-validator';
import { Salary } from './entities/salary.entity';
import { CreateSalaryDto } from './dto/create-salary.dto';
import { UpdateSalaryDto } from './dto/update-salary.dto';
import { PaymentMethodEnum } from '../../common/enums/salary.enums';
import { normalizeIban } from '../../common/utils/iban.util';

@Injectable()
export class SalariesService {
  constructor(@InjectRepository(Salary) private repo: Repository<Salary>) {}

  // نستخدم النوع الصحيح بدلاً من any
  private calculateTotal(
    data:
      | CreateSalaryDto
      | UpdateSalaryDto
      | Partial<
          Pick<
            Salary,
            | 'basicSalary'
            | 'housingAllowance'
            | 'transportAllowance'
            | 'otherAllowances'
          >
        >,
  ): number {
    return (
      Number(data.basicSalary || 0) +
      Number(data.housingAllowance || 0) +
      Number(data.transportAllowance || 0) +
      Number(data.otherAllowances || 0)
    );
  }

  async create(dto: CreateSalaryDto, tenantId: string) {
    const totalSalary = this.calculateTotal(dto);
    // ✅ الآيبان يُحفظ فقط عند الدفع البنكي (منظّف من المسافات)
    const iban =
      dto.paymentMethod === PaymentMethodEnum.BANK
        ? normalizeIban(dto.iban)
        : null;
    const salary = this.repo.create({ ...dto, iban, tenantId, totalSalary });
    return await this.repo.save(salary);
  }

  // ✅ تحديث findAll لجلب بيانات الموظف
  async findAll(tenantId: string) {
    return await this.repo.find({
      where: { tenantId },
      relations: ['employee'], // ✅ جلب بيانات الموظف للتصدير الجماعي
    });
  }

  // ✅ إضافة دالة findOne المفقودة
  async findOne(id: string, tenantId: string) {
    const salary = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['employee'], // ✅ ضروري للتصدير الفردي
    });
    if (!salary) throw new NotFoundException('الراتب غير موجود');
    return salary;
  }

  async update(id: string, dto: UpdateSalaryDto, tenantId: string) {
    const salary = await this.repo.findOne({ where: { id, tenantId } });
    if (!salary) throw new NotFoundException('الراتب غير موجود');

    Object.assign(salary, dto);
    salary.totalSalary = this.calculateTotal(salary);

    // ✅ مواءمة طريقة الدفع والآيبان بعد الدمج
    // (فحص الـ DTO لا يكفي في التحديث الجزئي: قد يصل iban بدون paymentMethod)
    if (salary.paymentMethod === PaymentMethodEnum.BANK) {
      salary.iban = normalizeIban(salary.iban);
      if (!salary.iban) {
        throw new BadRequestException('رقم الآيبان مطلوب عند الدفع البنكي');
      }
      if (!isIBAN(salary.iban)) {
        throw new BadRequestException('رقم الآيبان غير صالح');
      }
    } else {
      salary.iban = null;
    }

    return await this.repo.save(salary);
  }

  async findByEmployeeIds(ids: string[]) {
    if (!ids.length) return [];
    return await this.repo.find({
      where: { employeeId: In(ids) },
    });
  }

  // دالة جديدة لجلب راتب موظف محدد للتحقق منه عند طلب سلفة
  async findByEmployee(employeeId: string, tenantId: string) {
    return await this.repo.findOne({
      where: { employeeId, tenantId },
    });
  }
}
