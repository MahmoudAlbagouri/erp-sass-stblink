// src/modules/advances/advances.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Advance, AdvanceStatus } from './entities/advance.entity';
import { CreateAdvanceDto } from './dto/create-advance.dto';
import { SalariesService } from '../salaries/salaries.service';

@Injectable()
export class AdvancesService {
  constructor(
    @InjectRepository(Advance) private repo: Repository<Advance>,
    private salariesService: SalariesService,
  ) {}

  async create(dto: CreateAdvanceDto, employeeId: string, tenantId: string) {
    const salary = await this.salariesService.findByEmployee(
      employeeId,
      tenantId,
    );
    if (!salary)
      throw new NotFoundException('لم يتم العثور على سجل راتب لهذا الموظف');

    const totalSalary = Number(salary.totalSalary);
    const requestedAmount = Number(dto.amount);

    if (requestedAmount > totalSalary) {
      throw new BadRequestException(
        'قيمة السلفة لا يمكن أن تتجاوز إجمالي الراتب',
      );
    }

    const existingAdvances = await this.repo.find({
      where: {
        employeeId,
        tenantId,
        status: In([AdvanceStatus.PENDING, AdvanceStatus.APPROVED]),
      },
    });

    const totalPendingAdvances = existingAdvances.reduce(
      (sum, adv) => sum + Number(adv.amount),
      0,
    );

    if (totalPendingAdvances + requestedAmount > totalSalary) {
      throw new BadRequestException(
        `لا يمكن طلب هذه السلفة. لديك سلف معلقة بقيمة (${totalPendingAdvances}) والحد الأقصى هو راتبك (${totalSalary})`,
      );
    }

    const advance = this.repo.create({
      ...dto,
      employeeId,
      tenantId,
      repaymentDate: new Date(dto.repaymentDate),
    });

    return await this.repo.save(advance);
  }

  // ✅ تحديث findAll لجلب بيانات الموظف
  async findAll(tenantId: string) {
    return await this.repo.find({
      where: { tenantId },
      relations: ['employee'],
      order: { repaymentDate: 'ASC' },
    });
  }

  // ✅ إضافة findOne لدعم التصدير الفردي
  async findOne(id: string, tenantId: string) {
    const advance = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['employee'],
    });
    if (!advance) throw new NotFoundException('السلفة غير موجودة');
    return advance;
  }

  async updateStatus(id: string, status: AdvanceStatus, tenantId: string) {
    const advance = await this.repo.findOne({ where: { id, tenantId } });
    if (!advance) throw new NotFoundException('السلفة غير موجودة');

    advance.status = status;
    return await this.repo.save(advance);
  }
}
