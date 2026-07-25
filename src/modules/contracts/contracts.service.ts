// src/modules/contracts/contracts.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, Like } from 'typeorm';
import { Contract, ProbationPeriod } from './entities/contract.entity'; // تأكد من استيراد ProbationPeriod
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { addMonths } from 'date-fns'; // تأكد من تثبيت date-fns

@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(Contract)
    private readonly repo: Repository<Contract>,
  ) {}

  async create(dto: CreateContractDto, tenantId: string): Promise<Contract> {
    // التحقق من وجود عقد مسبق للموظف
    const existing = await this.repo.findOne({
      where: { employeeId: dto.employeeId, tenantId },
    });

    if (existing) {
      throw new BadRequestException('هذا الموظف لديه عقد مسجل بالفعل');
    }

    // ✅ 1. حساب تاريخ نهاية فترة التجربة
    let probationEndDate: Date | undefined = undefined;
    if (dto.probationPeriod && dto.probationPeriod !== ProbationPeriod.NONE) {
      const startDate = new Date(dto.startDate);
      if (dto.probationPeriod === ProbationPeriod.THREE_MONTHS) {
        probationEndDate = addMonths(startDate, 3);
      } else if (dto.probationPeriod === ProbationPeriod.SIX_MONTHS) {
        probationEndDate = addMonths(startDate, 6);
      }
    }

    // ✅ 2. حساب تاريخ نهاية العقد (إذا لم يُدخل يدوياً وكانت هناك مدة بالشهور)
    let calculatedEndDate: Date | undefined = undefined;
    if (dto.endDate) {
      calculatedEndDate = new Date(dto.endDate);
    } else if (dto.contractDurationMonths) {
      const startDate = new Date(dto.startDate);
      calculatedEndDate = addMonths(startDate, dto.contractDurationMonths);
    }

    const contract = this.repo.create({
      ...dto,
      tenantId,
      endDate: calculatedEndDate, // استخدام التاريخ المحسوب
      probationEndDate: probationEndDate, // حفظ تاريخ نهاية التجربة
    });

    return await this.repo.save(contract);
  }

  async findAll(tenantId: string): Promise<Contract[]> {
    return await this.repo.find({
      where: { tenantId },
      relations: ['employee'],
    });
  }

  async getByEmployeeId(
    employeeId: string,
    tenantId: string,
  ): Promise<Contract | null> {
    return await this.repo.findOne({
      where: { employeeId, tenantId },
    });
  }

  async search(tenantId: string, query: string) {
    return await this.repo.find({
      where: [
        {
          tenantId,
          employee: {
            fullName: ILike(`%${query}%`),
          },
        },
        {
          tenantId,
          contractType: Like(`%${query}%`) as any,
        },
      ],
      relations: ['employee'],
    });
  }

  async findOne(id: string, tenantId: string): Promise<Contract> {
    const contract = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['employee'],
    });
    if (!contract) throw new NotFoundException('العقد غير موجود');
    return contract;
  }

  async update(
    id: string,
    dto: UpdateContractDto,
    tenantId: string,
  ): Promise<Contract> {
    const contract = await this.findOne(id, tenantId);

    // ✅ إعادة حساب التواريخ عند التحديث إذا تغيرت المدخلات ذات الصلة
    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : contract.startDate;

    if (dto.probationPeriod !== undefined) {
      if (dto.probationPeriod === ProbationPeriod.THREE_MONTHS) {
        contract.probationEndDate = addMonths(startDate, 3);
      } else if (dto.probationPeriod === ProbationPeriod.SIX_MONTHS) {
        contract.probationEndDate = addMonths(startDate, 6);
      } else {
        contract.probationEndDate = undefined;
      }
    }

    if (dto.endDate) {
      contract.endDate = new Date(dto.endDate);
    } else if (dto.contractDurationMonths) {
      contract.endDate = addMonths(startDate, dto.contractDurationMonths);
    }

    Object.assign(contract, dto);
    return await this.repo.save(contract);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const contract = await this.findOne(id, tenantId);
    await this.repo.remove(contract);
  }
}
