import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Deduction, DeductionStatus } from './entities/deduction.entity';
import { CreateDeductionDto } from './dto/create-deduction.dto';
import { UpdateDeductionDto } from './dto/update-deduction.dto';
import { Employee } from '../employees/entities/employee.entity';

@Injectable()
export class DeductionsService {
  constructor(
    @InjectRepository(Deduction) private deductionRepo: Repository<Deduction>,
    @InjectRepository(Employee) private empRepo: Repository<Employee>,
  ) {}

  async create(dto: CreateDeductionDto, tenantId: string): Promise<Deduction> {
    const employee = await this.empRepo.findOne({
      where: { id: dto.employeeId, tenantId },
    });

    if (!employee)
      throw new NotFoundException('الموظف غير موجود أو لا ينتمي لشركتك');

    // ✅ حساب المبلغ الشهري تلقائياً
    const monthlyAmount = Number(
      (dto.totalAmount / dto.installmentsCount).toFixed(2),
    );

    const deduction = this.deductionRepo.create({
      ...dto,
      startDate: new Date(dto.startDate),
      monthlyAmount,
      paidInstallments: 0,
      // ✅ تعيين الحالة الافتراضية
      status: dto.status || DeductionStatus.PENDING,
      tenantId,
    });

    return this.deductionRepo.save(deduction);
  }

  async findAll(tenantId: string): Promise<Deduction[]> {
    return this.deductionRepo.find({
      where: { tenantId },
      relations: ['employee'],
      order: { startDate: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<Deduction> {
    const deduction = await this.deductionRepo.findOne({
      where: { id, tenantId },
      relations: ['employee'],
    });
    if (!deduction) throw new NotFoundException('الخصم غير موجود');
    return deduction;
  }

  async update(
    id: string,
    dto: UpdateDeductionDto,
    tenantId: string,
  ): Promise<Deduction> {
    const deduction = await this.findOne(id, tenantId);

    if (dto.employeeId && dto.employeeId !== deduction.employeeId) {
      const emp = await this.empRepo.findOne({
        where: { id: dto.employeeId, tenantId },
      });
      if (!emp) throw new NotFoundException('الموظف الجديد غير موجود');
    }

    Object.assign(deduction, dto);
    if (dto.startDate) deduction.startDate = new Date(dto.startDate);

    // ✅ إعادة حساب المبلغ الشهري إذا تغير المبلغ الكلي أو عدد الدفعات
    if (dto.totalAmount || dto.installmentsCount) {
      const total = dto.totalAmount ?? deduction.totalAmount;
      const count = dto.installmentsCount ?? deduction.installmentsCount;
      deduction.monthlyAmount = Number((total / count).toFixed(2));
    }

    return this.deductionRepo.save(deduction);
  }

  // ✅ دالة جديدة لتحديث حالة الخصم يدوياً
  async updateStatus(
    id: string,
    status: DeductionStatus,
    tenantId: string,
  ): Promise<Deduction> {
    const deduction = await this.findOne(id, tenantId);

    if (!Object.values(DeductionStatus).includes(status)) {
      throw new BadRequestException('حالة غير صالحة');
    }

    deduction.status = status;
    return this.deductionRepo.save(deduction);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const deduction = await this.findOne(id, tenantId);
    await this.deductionRepo.remove(deduction);
  }

  // ✅ دالة مساعدة لـ PayrollService لجلب الخصومات النشطة لشهر معين
  async getActiveForMonth(
    month: number,
    year: number,
    tenantId: string,
  ): Promise<Deduction[]> {
    // نطاق الشهر الحالي
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    // جلب الخصومات التي:
    // 1. بدأت قبل أو خلال هذا الشهر
    // 2. حالتها نشطة (أو يمكن الاعتماد على paidInstallments < installmentsCount)
    // 3. لم تنتهِ دفعاتها بعد
    return this.deductionRepo
      .find({
        where: {
          tenantId,
          startDate: Between(new Date(2000, 0, 1), monthEnd),
          status: DeductionStatus.ACTIVE, // ✅ جلب النشط فقط
        },
        relations: ['employee'],
      })
      .then((deductions) =>
        deductions.filter(
          (d) =>
            d.paidInstallments < d.installmentsCount && d.startDate <= monthEnd,
        ),
      );
  }
}
