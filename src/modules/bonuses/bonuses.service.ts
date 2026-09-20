import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { Bonus, BonusStatus } from './entities/bonus.entity';
import { CreateBonusDto } from './dto/create-bonus.dto';
import { UpdateBonusDto } from './dto/update-bonus.dto';
import { Employee } from '../employees/entities/employee.entity';

@Injectable()
export class BonusesService {
  constructor(
    @InjectRepository(Bonus) private bonusRepo: Repository<Bonus>,
    @InjectRepository(Employee) private empRepo: Repository<Employee>,
  ) {}

  async create(dto: CreateBonusDto, tenantId: string): Promise<Bonus> {
    const employee = await this.empRepo.findOne({
      where: { id: dto.employeeId, tenantId },
    });

    if (!employee)
      throw new NotFoundException('الموظف غير موجود أو لا ينتمي لشركتك');

    const bonus = this.bonusRepo.create({
      ...dto,
      payoutDate: new Date(dto.payoutDate),
      // ✅ تعيين الحالة الافتراضية إذا لم يتم تحديدها
      status: dto.status || BonusStatus.PENDING,
      tenantId,
    });

    return this.bonusRepo.save(bonus);
  }

  async findAll(tenantId: string): Promise<Bonus[]> {
    return this.bonusRepo.find({
      where: { tenantId },
      relations: ['employee', 'disbursedBy'],
      order: { payoutDate: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<Bonus> {
    const bonus = await this.bonusRepo.findOne({
      where: { id, tenantId },
      relations: ['employee', 'disbursedBy'],
    });
    if (!bonus) throw new NotFoundException('المكافأة غير موجودة');
    return bonus;
  }

  async update(
    id: string,
    dto: UpdateBonusDto,
    tenantId: string,
  ): Promise<Bonus> {
    const bonus = await this.findOne(id, tenantId);

    if (dto.employeeId && dto.employeeId !== bonus.employeeId) {
      const emp = await this.empRepo.findOne({
        where: { id: dto.employeeId, tenantId },
      });
      if (!emp) throw new NotFoundException('الموظف الجديد غير موجود');
    }

    Object.assign(bonus, dto);
    if (dto.payoutDate) bonus.payoutDate = new Date(dto.payoutDate);

    return this.bonusRepo.save(bonus);
  }

  // ✅ دالة جديدة لتحديث حالة المكافأة (موافقة / رفض)
  async updateStatus(
    id: string,
    status: BonusStatus,
    tenantId: string,
  ): Promise<Bonus> {
    const bonus = await this.findOne(id, tenantId);

    // التحقق من أن الحالة الجديدة صحيحة
    if (!Object.values(BonusStatus).includes(status)) {
      throw new BadRequestException('حالة غير صالحة');
    }

    bonus.status = status;
    return this.bonusRepo.save(bonus);
  }

  /**
   * ✅ تأكيد الصرف الاستثنائي المباشر (Off-Cycle Disbursement)
   * يُستخدم عند صرف المكافأة للموظف مباشرة خارج دورة المسير الشهري.
   * ملاحظة: المبلغ يظل محسوباً ضمن إجمالي مستحقات الموظف عند توليد
   * المسير الشهري (للشفافية)، لكن PayrollService يخصمه فوراً من الصافي
   * عبر حقل prepaidBonuses في PayrollItem لتفادي ازدواجية الصرف.
   */
  async disburseBonus(
    id: string,
    tenantId: string,
    userId: string,
  ): Promise<Bonus> {
    const bonus = await this.bonusRepo.findOne({ where: { id, tenantId } });
    if (!bonus) throw new NotFoundException('المكافأة غير موجودة');
    if (bonus.status !== BonusStatus.APPROVED) {
      throw new BadRequestException(
        'لا يمكن صرف مكافأة غير معتمدة (يجب اعتمادها أولاً)',
      );
    }
    if (bonus.isDisbursed) {
      throw new BadRequestException('تم صرف هذه المكافأة مسبقاً');
    }

    bonus.isDisbursed = true;
    bonus.disbursedById = userId;
    bonus.disbursedAt = new Date();

    return this.bonusRepo.save(bonus);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const bonus = await this.findOne(id, tenantId);
    await this.bonusRepo.remove(bonus);
  }

  // ✅ دالة مساعدة لـ PayrollService لجلب مكافآت شهر معين
  async findByMonthAndYear(
    month: number,
    year: number,
    tenantId: string,
  ): Promise<Bonus[]> {
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    return this.bonusRepo.find({
      where: {
        tenantId,
        payoutDate: Between(monthStart, monthEnd),
      },
      relations: ['employee'],
    });
  }
}
