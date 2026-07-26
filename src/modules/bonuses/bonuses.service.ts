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
      relations: ['employee'],
      order: { payoutDate: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<Bonus> {
    const bonus = await this.bonusRepo.findOne({
      where: { id, tenantId },
      relations: ['employee'],
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
