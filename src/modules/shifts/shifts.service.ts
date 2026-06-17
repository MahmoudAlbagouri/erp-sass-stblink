import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shift } from './entities/shift.entity';
import { CreateShiftDto } from './dto/create-shift.dto';
import { UpdateShiftDto } from './dto/update-shift.dto';

@Injectable()
export class ShiftsService {
  constructor(@InjectRepository(Shift) private repo: Repository<Shift>) {}

  async create(dto: CreateShiftDto, tenantId: string) {
    const shift = this.repo.create({ ...dto, tenantId });
    return await this.repo.save(shift);
  }

  async findAll(tenantId: string) {
    return await this.repo.find({ where: { tenantId } });
  }

  async update(id: string, dto: UpdateShiftDto, tenantId: string) {
    const shift = await this.repo.findOne({ where: { id, tenantId } });
    if (!shift) throw new NotFoundException('الوردية غير موجودة');
    Object.assign(shift, dto);
    return await this.repo.save(shift);
  }

  async remove(id: string, tenantId: string) {
    const result = await this.repo.delete({ id, tenantId });
    if (result.affected === 0)
      throw new NotFoundException('الوردية غير موجودة');
  }
}
