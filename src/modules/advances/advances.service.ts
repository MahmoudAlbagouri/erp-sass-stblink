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
    // 1. جلب الراتب
    const salary = await this.salariesService.findByEmployee(
      employeeId,
      tenantId,
    );
    if (!salary)
      throw new NotFoundException('لم يتم العثور على سجل راتب لهذا الموظف');

    const totalSalary = Number(salary.totalSalary);
    const requestedAmount = Number(dto.amount);

    // 2. التحقق من أن السلفة لا تزيد عن الراتب
    if (requestedAmount > totalSalary) {
      throw new BadRequestException(
        'قيمة السلفة لا يمكن أن تتجاوز إجمالي الراتب',
      );
    }

    // 3. حساب مجموع السلف المعلقة (التي لم تسدد بعد)
    // نعتبر السلفة "معلقة" إذا كانت حالتها pending أو approved ولم تصل لـ paid
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

    // 4. التحقق من أن المجموع لا يتجاوز الراتب
    if (totalPendingAdvances + requestedAmount > totalSalary) {
      throw new BadRequestException(
        `لا يمكن طلب هذه السلفة. لديك سلف معلقة بقيمة (${totalPendingAdvances}) والحد الأقصى هو راتبك (${totalSalary})`,
      );
    }

    // إنشاء السلفة
    const advance = this.repo.create({
      ...dto,
      employeeId,
      tenantId,
      repaymentDate: new Date(dto.repaymentDate),
    });

    return await this.repo.save(advance);
  }

  async findAll(tenantId: string) {
    return await this.repo.find({
      where: { tenantId },
      relations: ['employee'],
      order: { repaymentDate: 'ASC' }, // ترتيب حسب تاريخ السداد
    });
  }

  async updateStatus(id: string, status: AdvanceStatus, tenantId: string) {
    const advance = await this.repo.findOne({ where: { id, tenantId } });
    if (!advance) throw new NotFoundException('السلفة غير موجودة');

    advance.status = status;
    return await this.repo.save(advance);
  }
}
