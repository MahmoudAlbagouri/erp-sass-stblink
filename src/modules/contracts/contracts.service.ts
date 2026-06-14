import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contract } from './entities/contract.entity';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';

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

    const contract = this.repo.create({
      ...dto,
      tenantId,
    });
    return await this.repo.save(contract);
  }

  async findAll(tenantId: string): Promise<Contract[]> {
    return await this.repo.find({
      where: { tenantId },
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

    // تحديث البيانات
    Object.assign(contract, dto);

    return await this.repo.save(contract);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const contract = await this.findOne(id, tenantId);
    await this.repo.remove(contract);
  }

  async getByEmployeeId(
    employeeId: string,
    tenantId: string,
  ): Promise<Contract | null> {
    return await this.repo.findOne({
      where: { employeeId, tenantId },
      relations: ['employee'],
    });
  }

  // دالة إضافية لحساب المدة تلقائياً عند الحاجة
  async getContractDuration(id: string, tenantId: string) {
    const contract = await this.findOne(id, tenantId);
    const start = new Date(contract.startDate);
    const end = contract.endDate ? new Date(contract.endDate) : new Date();

    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return {
      durationInDays: diffDays,
      isActive: !contract.endDate || new Date(contract.endDate) > new Date(),
    };
  }
}
