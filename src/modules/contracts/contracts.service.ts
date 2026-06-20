// src/modules/contracts/contracts.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, Like } from 'typeorm';
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

  // ✅ دالة جديدة لجلب عقد موظف محدد (مطلوبة لموديول الإجازات)
  async getByEmployeeId(
    employeeId: string,
    tenantId: string,
  ): Promise<Contract | null> {
    return await this.repo.findOne({
      where: { employeeId, tenantId },
    });
  }

  // دالة البحث
  async search(tenantId: string, query: string) {
    return await this.repo.find({
      where: [
        // الشرط الأول: البحث باسم الموظف
        {
          tenantId,
          employee: {
            fullName: ILike(`%${query}%`),
          },
        },
        // الشرط الثاني: البحث بنوع العقد
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
    Object.assign(contract, dto);
    return await this.repo.save(contract);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const contract = await this.findOne(id, tenantId);
    await this.repo.remove(contract);
  }
}
