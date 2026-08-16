// src/modules/eos/eos.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import Decimal from 'decimal.js';
import { EndOfService, EOSReason } from './entities/eos.entity';
import { CreateEOSDto } from './dto/create-eos.dto';
import { UpdateEOSDto } from './dto/update-eos.dto';
import { Employee } from '../employees/entities/employee.entity';
import { ContractsService } from '../contracts/contracts.service';
import { SalariesService } from '../salaries/salaries.service';
import { DateUtils } from '../../common/utils/date.utils';

@Injectable()
export class EOSService {
  constructor(
    @InjectRepository(EndOfService) private eosRepo: Repository<EndOfService>,
    @InjectRepository(Employee) private empRepo: Repository<Employee>,
    private contractsService: ContractsService,
    private salariesService: SalariesService,
    private dateUtils: DateUtils,
  ) {}

  /**
   * ✅ حساب دقيق تقويمياً لمدة الخدمة (سنوات كاملة + شهور + أيام متبقية)
   * بدلاً من قسمة إجمالي الأيام على 365 مباشرة، وده بيحمي من مشكلة
   * وقوع الموظف في الشريحة القانونية الخطأ (2 أو 5 أو 10 سنين) بسبب
   * فروق تقريب بسيطة ناتجة عن السنوات الكبيسة.
   */
  private calculatePreciseServiceDuration(
    startDate: Date,
    endDate: Date,
  ): { years: number; months: number; days: number; serviceYears: Decimal } {
    let years = endDate.getFullYear() - startDate.getFullYear();
    let months = endDate.getMonth() - startDate.getMonth();
    let days = endDate.getDate() - startDate.getDate();

    if (days < 0) {
      months -= 1;
      // ✅ عدد أيام الشهر السابق لشهر تاريخ الانتهاء (يراعي فبراير/الكبيسة تلقائياً)
      const prevMonthLastDay = new Date(
        endDate.getFullYear(),
        endDate.getMonth(),
        0,
      ).getDate();
      days += prevMonthLastDay;
    }
    if (months < 0) {
      years -= 1;
      months += 12;
    }

    // السنوات الكاملة + كسر الشهور (÷12) + كسر الأيام المتبقية (÷365) لدقة أعلى
    const serviceYears = new Decimal(years)
      .plus(new Decimal(months).dividedBy(12))
      .plus(new Decimal(days).dividedBy(365));

    return { years, months, days, serviceYears };
  }

  async create(dto: CreateEOSDto, tenantId: string): Promise<EndOfService> {
    const employee = await this.empRepo.findOne({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee)
      throw new NotFoundException('الموظف غير موجود أو لا ينتمي لشركتك');

    // ✅ 1. التحقق من عدم وجود نهاية خدمة سابقة للموظف
    const existingEOS = await this.eosRepo.findOne({
      where: { employeeId: dto.employeeId, tenantId },
    });
    if (existingEOS) {
      throw new BadRequestException(
        `هذا الموظف لديه سجل نهاية خدمة مسجل مسبقاً بتاريخ ${new Date(
          existingEOS.terminationDate,
        ).toLocaleDateString()}. لا يمكن تسجيل نهاية خدمة لموظف تم إنهاء خدماته بالفعل.`,
      );
    }

    const contract = await this.contractsService.getByEmployeeId(
      dto.employeeId,
      tenantId,
    );
    if (!contract)
      throw new BadRequestException(
        'لا يوجد عقد نشط لهذا الموظف لحساب نهاية الخدمة',
      );

    const salary = await this.salariesService.findByEmployee(
      dto.employeeId,
      tenantId,
    );
    if (!salary) throw new BadRequestException('لا يوجد راتب مسجل للموظف');

    // ✅ 2. التحقق من صحة التواريخ منطقياً
    const terminationDate = new Date(dto.terminationDate);
    const payoutDate = new Date(dto.payoutDate);
    const startDate = new Date(contract.startDate);

    if (terminationDate < startDate) {
      throw new BadRequestException(
        'تاريخ انتهاء الخدمة لا يمكن أن يكون قبل تاريخ بداية العقد',
      );
    }

    if (payoutDate < terminationDate) {
      throw new BadRequestException(
        'تاريخ صرف المكافأة لا يمكن أن يكون قبل تاريخ انتهاء الخدمة',
      );
    }

    // ✅ 3. حساب مدة الخدمة بدقة تقويمية (سنوات/شهور/أيام) بدل days/365 المباشرة
    // هذا يمنع وقوع الموظف في شريحة قانونية خاطئة (2 أو 5 أو 10 سنين)
    // بسبب فروق تقريب بسيطة ناتجة عن السنوات الكبيسة
    const { serviceYears } = this.calculatePreciseServiceDuration(
      startDate,
      terminationDate,
    );

    // ✅ 4. حساب مكافأة نهاية الخدمة وفق المادة 84/85
    // ✅ التصحيح: استخدام الراتب الكلي (الأساسي + كل البدلات) بدل الأساسي فقط
    const totalSalaryForCalc = Number(salary.totalSalary);
    let eosAmount = new Decimal(0);

    if (serviceYears.lessThanOrEqualTo(5)) {
      eosAmount = serviceYears.times(totalSalaryForCalc).times(0.5);
    } else {
      const firstFive = new Decimal(5).times(totalSalaryForCalc).times(0.5);
      const remainingYears = serviceYears.minus(5);
      eosAmount = firstFive.plus(remainingYears.times(totalSalaryForCalc));
    }

    // ✅ تطبيق نسبة الاستحقاق بناءً على السبب
    if (dto.reason === EOSReason.RESIGNATION) {
      if (serviceYears.lessThan(2)) {
        eosAmount = new Decimal(0);
      } else if (
        serviceYears.greaterThanOrEqualTo(2) &&
        serviceYears.lessThan(5)
      ) {
        eosAmount = eosAmount.dividedBy(3);
      } else if (
        serviceYears.greaterThanOrEqualTo(5) &&
        serviceYears.lessThan(10)
      ) {
        eosAmount = eosAmount.times(2).dividedBy(3);
      }
    }

    const eos = this.eosRepo.create({
      ...dto,
      terminationDate,
      payoutDate,
      serviceYears: parseFloat(serviceYears.toFixed(3)),
      eosAmount: parseFloat(eosAmount.toFixed(2)),
      // ⚠️ ملاحظة: هذا الحقل اسمه lastBasicSalary تاريخياً في الـ schema،
      // لكنه الآن يخزّن الراتب الكلي (الأساسي + البدلات) المستخدم فعلياً
      // في الحساب. راجع اقتراح الـ migration لإضافة lastTotalSalary
      // كحقل منفصل إذا أردت توضيح الاسم مستقبلاً.
      lastBasicSalary: totalSalaryForCalc,
      tenantId,
    });

    return this.eosRepo.save(eos);
  }

  async findAll(tenantId: string): Promise<EndOfService[]> {
    return this.eosRepo.find({
      where: { tenantId },
      relations: ['employee'],
      order: { terminationDate: 'DESC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<EndOfService> {
    const eos = await this.eosRepo.findOne({
      where: { id, tenantId },
      relations: ['employee'],
    });
    if (!eos) throw new NotFoundException('سجل نهاية الخدمة غير موجود');
    return eos;
  }

  async update(
    id: string,
    dto: UpdateEOSDto,
    tenantId: string,
  ): Promise<EndOfService> {
    const eos = await this.findOne(id, tenantId);

    // ✅ منع تغيير بيانات موظف آخر بالخطأ عند التعديل
    if (dto.employeeId && dto.employeeId !== eos.employeeId) {
      throw new BadRequestException(
        'لا يمكن نقل سجل نهاية الخدمة لموظف آخر. يرجى حذف السجل وإنشاء جديد.',
      );
    }

    Object.assign(eos, dto);
    if (dto.terminationDate)
      eos.terminationDate = new Date(dto.terminationDate);
    if (dto.payoutDate) eos.payoutDate = new Date(dto.payoutDate);

    return this.eosRepo.save(eos);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const eos = await this.findOne(id, tenantId);
    await this.eosRepo.remove(eos);
  }

  async findByPayoutMonth(
    month: number,
    year: number,
    tenantId: string,
  ): Promise<EndOfService[]> {
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    return this.eosRepo.find({
      where: { tenantId, payoutDate: Between(monthStart, monthEnd) },
      relations: ['employee'],
    });
  }
}
