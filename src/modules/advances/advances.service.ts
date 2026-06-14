// src/modules/advances/advances.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Advance, AdvanceStatus } from './entities/advance.entity';
import { CreateAdvanceDto } from './dto/create-advance.dto';

@Injectable()
export class AdvancesService {
  constructor(@InjectRepository(Advance) private repo: Repository<Advance>) {}

  async create(dto: CreateAdvanceDto, employeeId: string, tenantId: string) {
    const advance = this.repo.create({ ...dto, employeeId, tenantId });
    return await this.repo.save(advance);
  }

  async findAll(tenantId: string) {
    return await this.repo.find({
      where: { tenantId },
      relations: ['employee'],
    });
  }

  async updateStatus(id: string, status: AdvanceStatus, tenantId: string) {
    const advance = await this.repo.findOne({ where: { id, tenantId } });
    if (!advance) throw new NotFoundException('السلفة غير موجودة');
    advance.status = status;
    return await this.repo.save(advance);
  }
}
