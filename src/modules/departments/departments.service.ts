import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Department } from './entities/department.entity';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    @InjectRepository(Department)
    private readonly repo: Repository<Department>,
  ) {}

  async create(
    dto: CreateDepartmentDto,
    tenantId: string,
  ): Promise<Department> {
    const existing = await this.repo.findOne({
      where: { name: dto.name, tenantId },
    });
    if (existing) {
      throw new ConflictException(`القسم "${dto.name}" موجود بالفعل`);
    }
    const department = this.repo.create({ ...dto, tenantId });
    return await this.repo.save(department);
  }

  async findAll(tenantId: string): Promise<Department[]> {
    return await this.repo.find({
      where: { tenantId },
      order: { name: 'ASC' },
    });
  }

  /**
   * ✅ الأقسام مع عدد الموظفين في كل قسم — تُستخدم في الصفحة الرئيسية
   */
  async findAllWithCounts(
    tenantId: string,
  ): Promise<Array<Department & { employeesCount: number }>> {
    const departments = await this.repo
      .createQueryBuilder('department')
      .loadRelationCountAndMap(
        'department.employeesCount',
        'department.employees',
      )
      .where('department.tenantId = :tenantId', { tenantId })
      .orderBy('department.name', 'ASC')
      .getMany();

    return departments as Array<Department & { employeesCount: number }>;
  }

  async update(
    id: string,
    dto: UpdateDepartmentDto,
    tenantId: string,
  ): Promise<Department> {
    const department = await this.repo.findOne({ where: { id, tenantId } });
    if (!department) throw new NotFoundException('القسم غير موجود');

    if (dto.name && dto.name !== department.name) {
      const existing = await this.repo.findOne({
        where: { name: dto.name, tenantId },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(`القسم "${dto.name}" موجود بالفعل`);
      }
    }

    Object.assign(department, dto);
    return await this.repo.save(department);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const department = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['employees'],
    });
    if (!department) throw new NotFoundException('القسم غير موجود');

    if (department.employees && department.employees.length > 0) {
      throw new ConflictException(
        `لا يمكن حذف القسم لوجود ${department.employees.length} موظف مرتبط به`,
      );
    }

    await this.repo.remove(department);
  }
}
