// src/modules/plans/plans.service.ts
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from './entities/plan.entity';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
  ) {}

  async create(dto: CreatePlanDto): Promise<Plan> {
    const existing = await this.planRepo.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException(`الخطة باسم '${dto.name}' موجودة بالفعل`);
    }

    const plan = this.planRepo.create(dto);
    return this.planRepo.save(plan);
  }

  async findAll(includeInactive = false): Promise<Plan[]> {
    if (includeInactive) {
      return this.planRepo.find({ order: { sortOrder: 'ASC' } });
    }
    return this.planRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Plan> {
    const plan = await this.planRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException(`Plan with ID ${id} not found`);
    return plan;
  }

  // ✅ دالة مساعدة للبحث بالمعرف
  async getPlanById(id: string): Promise<Plan> {
    const plan = await this.planRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException(`الخطة (${id}) غير موجودة`);
    return plan;
  }

  // ✅ دالة مساعدة للبحث بالاسم (مهمة للاشتراك التجريبي)
  async getPlanByName(name: string): Promise<Plan> {
    const plan = await this.planRepo.findOne({ where: { name } });
    if (!plan) throw new NotFoundException(`الخطة (${name}) غير موجودة`);
    return plan;
  }

  async update(id: string, dto: UpdatePlanDto): Promise<Plan> {
    const plan = await this.findOne(id);
    Object.assign(plan, dto);
    return this.planRepo.save(plan);
  }

  async remove(id: string): Promise<void> {
    const plan = await this.findOne(id);
    plan.isActive = false;
    await this.planRepo.save(plan);
  }
}
